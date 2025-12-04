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
        const { sessionId, userType = 'user' } = data;
        
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
          return callback({ success: false, message: 'Unauthorized: admin token required' });
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
            question: poll.question,
            type: poll.type,
            options: poll.options,
            results: userType === 'admin' ? poll.results : poll.results.map(r => ({ option: r.option, votes: r.votes })),
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
        const { sessionId, vote, userId } = data;
        
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

        // Check if user already voted
        if (poll.voters.includes(userId)) {
          return callback({
            success: false,
            message: 'You have already voted'
          });
        }

        // Process vote atomically
        let updateQuery = {};
        
        if (poll.type === 'multiple-choice') {
          const optionIndex = poll.results.findIndex(r => r.option === vote);
          if (optionIndex === -1) {
            return callback({
              success: false,
              message: 'Invalid option'
            });
          }
          
          updateQuery = {
            $inc: { [`results.${optionIndex}.votes`]: 1 },
            $push: { voters: userId }
          };
        } else if (poll.type === 'yes-no') {
          const optionIndex = poll.results.findIndex(r => r.option.toLowerCase() === vote.toLowerCase());
          if (optionIndex === -1) {
            return callback({
              success: false,
              message: 'Invalid option'
            });
          }
          
          updateQuery = {
            $inc: { [`results.${optionIndex}.votes`]: 1 },
            $push: { voters: userId }
          };
        } else {
          // For open-text and rating
          updateQuery = {
            $push: { 
              voters: userId,
              responses: { 
                userId, 
                response: vote, 
                timestamp: new Date() 
              }
            }
          };
        }

        const updatedPoll = await Poll.findOneAndUpdate(
          buildPollQuery(sessionId),
          updateQuery,
          { new: true }
        );

        logger.info('Vote recorded via socket', { 
          sessionId, 
          userId, 
          socketId: socket.id 
        });

        callback({
          success: true,
          message: 'Vote recorded'
        });

        // Broadcast updated results to all users in the poll room
        io.to(`poll_${targetSessionId}`).emit('pollUpdate', {
          results: updatedPoll.results,
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
          return callback({ success: false, message: 'Unauthorized: admin token required' });
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
          finalResults: poll.results,
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