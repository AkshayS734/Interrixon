import Poll from '../models/Poll.js';
import Admin from '../models/Admin.js';
import logger from '../utils/logger.js';
import { createRateLimiter } from '../utils/rateLimiter.js';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

// Rate limiters for socket events
const voteLimiter = createRateLimiter(10, 60); // 10 votes per minute
const joinLimiter = createRateLimiter(20, 60); // 20 joins per minute

function isValidIdentifier(id) {
  if (typeof id !== 'string') return false;
  const sixChar = /^[A-Z0-9]{6}$/i;
  const objectId = /^[a-fA-F0-9]{24}$/;
  return sixChar.test(id) || objectId.test(id);
}

function buildPollQuery(id) {
  const objectId = /^[a-fA-F0-9]{24}$/;
  if (objectId.test(id)) {
    try {
      return { $or: [{ sessionId: id }, { _id: mongoose.Types.ObjectId(id) }] };
    } catch (e) {
      return { sessionId: id };
    }
  }
  return { sessionId: id };
}

async function verifyAdminToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded && decoded.adminId) {
      try {
        const admin = await Admin.findById(decoded.adminId);
        return admin || null;
      } catch (err) {
        logger.warn('Admin lookup failed in per-event token verify', { error: err?.message || err });
        return null;
      }
    }
    return null;
  } catch (err) {
    logger.warn('Per-event admin token verification failed', { error: err?.message || err });
    return null;
  }
}

export const handleSocketConnection = (io) => {
  io.on('connection', async (socket) => {
    logger.info('Client connected', { socketId: socket.id });

    // Try to verify JWT if provided in the handshake auth
    try {
      const token = socket.handshake?.auth?.token;
      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        // decoded should contain adminId
        if (decoded && decoded.adminId) {
          try {
            const admin = await Admin.findById(decoded.adminId);
            if (admin) {
              socket.user = { type: 'admin', admin };
              logger.info('Socket authenticated as admin', { socketId: socket.id, adminId: admin._id });
            }
          } catch (err) {
            logger.warn('Admin lookup failed for socket token', { socketId: socket.id, error: err?.message || err });
          }
        }
      }
    } catch (err) {
      logger.warn('Socket JWT verification failed', { socketId: socket.id, error: err?.message || err });
    }
    
    // Join poll room
    socket.on('joinPoll', async (data, callback) => {
      try {
        const { sessionId, userType = 'user', adminToken } = data;
        
        if (!joinLimiter.check(socket.id)) {
          return callback({
            success: false,
            message: 'Too many join attempts'
          });
        }
        
        if (!isValidIdentifier(sessionId)) {
          return callback({ success: false, message: 'Invalid session ID' });
        }

        // If user requests admin view, ensure socket is authenticated as admin
        if (userType === 'admin' && (!socket.user || socket.user.type !== 'admin')) {
          // Try per-event admin token fallback
          const perEventAdmin = await verifyAdminToken(adminToken);
          if (!perEventAdmin) {
            return callback({ success: false, message: 'Unauthorized: admin token required' });
          }
          // attach temporary admin for this socket event
          socket.user = { type: 'admin', admin: perEventAdmin };
        }

        // Resolve to poll document regardless of whether client sent 6-char or 24-char id
        const poll = await Poll.findOne({
          ...buildPollQuery(sessionId)
        });

        if (!poll) {
          return callback({ success: false, message: 'Poll not found' });
        }

        // Allow joining closed/expired polls so that results can be viewed.
        // We still return the poll's isActive flag so the client can render accordingly.

        // Join the poll room
        // Always use the poll's user-facing sessionId as the room identifier
        const roomSessionId = poll.sessionId;

        await socket.join(`poll_${roomSessionId}`);

        // Store user info in socket
        socket.pollData = {
          sessionId: roomSessionId,
          userType,
          joinedAt: new Date()
        };

        logger.info('User joined poll', { 
          socketId: socket.id, 
          sessionId: roomSessionId, 
          userType 
        });

        // Send current poll data (include results even for closed polls)
        callback({
          success: true,
          poll: {
            sessionId: poll.sessionId,
            systemId: poll._id.toString(),
            questions: (poll.questions || []).map(q => ({
              _id: q._id,
              question: q.question,
              type: q.type,
              options: q.options,
              results: userType === 'admin' ? q.results : q.results.map(r => {
                if (r.option !== undefined) {
                  return { option: r.option, votes: r.votes };
                }
                return r; // for rating/open-text
              })
            })),
            responses: poll.responses || [],
            expiresAt: poll.expiresAt,
            totalVotes: poll.voters.length,
            isActive: poll.isActive && poll.expiresAt > new Date()
          }
        });

        // Notify room about new participant
        socket.to(`poll_${roomSessionId}`).emit('participantJoined', {
          participantCount: (await io.in(`poll_${roomSessionId}`).allSockets()).size
        });

      } catch (error) {
        logger.error('Join poll error', { 
          error: error.message, 
          socketId: socket.id 
        });
        callback({
          success: false,
          message: 'Failed to join poll'
        });
      }
    });

    // Handle voting
    socket.on('vote', async (data, callback) => {
      try {
        const { sessionId, questionId, vote, userId } = data;
        
        if (!voteLimiter.check(socket.id)) {
          return callback({
            success: false,
            message: 'Voting too frequently'
          });
        }

        if (!socket.pollData) {
          return callback({ success: false, message: 'You must join the poll first' });
        }

        // If the client passed a 24-char id, normalize by resolving the poll
        let targetSessionId = sessionId;
        if (!isValidIdentifier(sessionId)) {
          return callback({ success: false, message: 'Invalid session ID' });
        }

        const pollForVote = await Poll.findOne(buildPollQuery(sessionId));
        if (!pollForVote) return callback({ success: false, message: 'Poll not found or expired' });

        targetSessionId = pollForVote.sessionId;

        if (socket.pollData.sessionId !== targetSessionId) {
          return callback({
            success: false,
            message: 'You must join the poll first'
          });
        }

        const poll = pollForVote; // already fetched above

        if (!poll) {
          return callback({
            success: false,
            message: 'Poll not found or expired'
          });
        }

        // Check if user already voted on THIS specific question
        const alreadyVotedOnQuestion = poll.responses.some(
          r => r.userId === userId && r.questionId.toString() === questionId
        );
        if (alreadyVotedOnQuestion) {
          return callback({
            success: false,
            message: 'You have already voted on this question'
          });
        }

        // Find the question
        const questionIndex = poll.questions.findIndex(q => q._id.toString() === questionId);
        if (questionIndex === -1) {
          return callback({
            success: false,
            message: 'Question not found'
          });
        }

        const question = poll.questions[questionIndex];
        const type = question.type;

        // Process vote atomically
        let updateQuery = {};
        
        if (type === 'multiple-choice' || type === 'yes-no') {
          const optionIndex = question.results.findIndex(r => r.option === vote);
          if (optionIndex === -1) {
            return callback({
              success: false,
              message: 'Invalid option'
            });
          }
          
          updateQuery = {
            $inc: { [`questions.${questionIndex}.results.${optionIndex}.votes`]: 1 },
            $push: { responses: { userId, questionId, response: vote, timestamp: new Date() } }
          };
          
          // Only add to voters if they haven't voted on ANY question yet
          if (!poll.voters.includes(userId)) {
            updateQuery.$push.voters = userId;
          }
        } else if (type === 'rating') {
          const rating = parseInt(vote, 10);
          if (isNaN(rating) || rating < 1 || rating > 5) {
            return callback({
              success: false,
              message: 'Rating must be between 1 and 5'
            });
          }
          
          updateQuery = {
            $push: { 
              responses: { userId, questionId, response: rating, timestamp: new Date() }
            }
          };
          
          // Only add to voters if they haven't voted on ANY question yet
          if (!poll.voters.includes(userId)) {
            updateQuery.$push.voters = userId;
          }
        } else if (type === 'open-text') {
          updateQuery = {
            $push: { 
              responses: { userId, questionId, response: vote, timestamp: new Date() }
            }
          };
          
          // Only add to voters if they haven't voted on ANY question yet
          if (!poll.voters.includes(userId)) {
            updateQuery.$push.voters = userId;
          }
        }

        const updatedPoll = await Poll.findOneAndUpdate(
          buildPollQuery(sessionId),
          updateQuery,
          { new: true }
        );

        logger.info('Vote recorded via socket', { 
          sessionId, 
          questionId,
          userId, 
          socketId: socket.id 
        });

        callback({
          success: true,
          message: 'Vote recorded'
        });

        // Broadcast updated results to all users in the poll room
        const updatedQuestion = updatedPoll.questions.find(q => q._id.toString() === questionId);
        io.to(`poll_${targetSessionId}`).emit('pollUpdate', {
          questionId,
          results: updatedQuestion.results,
          responses: updatedPoll.responses.filter(r => r.questionId.toString() === questionId),
          type: updatedQuestion.type,
          totalVotes: updatedPoll.voters.length,
          lastUpdate: new Date()
        });

      } catch (error) {
        logger.error('Socket vote error', { 
          error: error.message, 
          socketId: socket.id 
        });
        callback({
          success: false,
          message: 'Failed to record vote'
        });
      }
    });

    // Handle poll closure (admin only)
    socket.on('closePoll', async (data, callback) => {
      try {
        const { sessionId, adminToken } = data;

        // Require server-side socket authentication for admin actions
        if (!socket.user || socket.user.type !== 'admin') {
          // fallback to per-event token
          const perEventAdmin = await verifyAdminToken(adminToken);
          if (!perEventAdmin) {
            return callback({ success: false, message: 'Unauthorized: admin token required' });
          }
          socket.user = { type: 'admin', admin: perEventAdmin };
        }

        if (!isValidIdentifier(sessionId)) {
          return callback({ success: false, message: 'Invalid session ID' });
        }

        const poll = await Poll.findOneAndUpdate(
          buildPollQuery(sessionId),
          {
            isActive: false,
            closedAt: new Date()
          },
          { new: true }
        );

        if (!poll) {
          return callback({
            success: false,
            message: 'Poll not found'
          });
        }

        logger.info('Poll closed by admin', { 
          sessionId: poll.sessionId, 
          socketId: socket.id 
        });

        callback({
          success: true,
          message: 'Poll closed'
        });

        // Notify all participants
        io.to(`poll_${poll.sessionId}`).emit('pollClosed', {
          message: 'This poll has been closed by the administrator',
          finalQuestions: poll.questions.map(q => ({
            _id: q._id,
            question: q.question,
            type: q.type,
            options: q.options,
            results: q.results
          })),
          finalResponses: poll.responses || [],
          closedAt: new Date()
        });

      } catch (error) {
        logger.error('Close poll error', { 
          error: error.message, 
          socketId: socket.id 
        });
        callback({
          success: false,
          message: 'Failed to close poll'
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info('Client disconnected', { 
        socketId: socket.id, 
        reason,
        pollData: socket.pollData 
      });

      // Notify poll room if user was in a poll
      if (socket.pollData && socket.pollData.sessionId) {
        socket.to(`poll_${socket.pollData.sessionId}`).emit('participantLeft', {
          message: 'A participant left the poll'
        });
      }
    });

    // Handle connection errors
    socket.on('error', (error) => {
      logger.error('Socket error', { 
        error: error.message, 
        socketId: socket.id 
      });
    });
  });
};