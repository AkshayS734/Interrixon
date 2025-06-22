import Poll from '../models/Poll.js';
import logger from '../utils/logger.js';
import { createRateLimiter } from '../utils/rateLimiter.js';

// Rate limiters for socket events
const voteLimiter = createRateLimiter(10, 60); // 10 votes per minute
const joinLimiter = createRateLimiter(20, 60); // 20 joins per minute

export const handleSocketConnection = (io) => {
  io.on('connection', (socket) => {
    logger.info('Client connected', { socketId: socket.id });
    
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
        
        if (!sessionId || sessionId.length !== 6) {
          return callback({
            success: false,
            message: 'Invalid session ID'
          });
        }

        const poll = await Poll.findOne({ 
          sessionId,
          expiresAt: { $gt: new Date() },
          isActive: true
        });

        if (!poll) {
          return callback({
            success: false,
            message: 'Poll not found or expired'
          });
        }

        // Join the poll room
        await socket.join(`poll_${sessionId}`);
        
        // Store user info in socket
        socket.pollData = {
          sessionId,
          userType,
          joinedAt: new Date()
        };

        logger.info('User joined poll', { 
          socketId: socket.id, 
          sessionId, 
          userType 
        });

        // Send current poll data
        callback({
          success: true,
          poll: {
            sessionId: poll.sessionId,
            question: poll.question,
            type: poll.type,
            options: poll.options,
            results: userType === 'admin' ? poll.results : poll.results.map(r => ({ option: r.option, votes: r.votes })),
            expiresAt: poll.expiresAt,
            totalVotes: poll.voters.length
          }
        });

        // Notify room about new participant
        socket.to(`poll_${sessionId}`).emit('participantJoined', {
          participantCount: (await io.in(`poll_${sessionId}`).allSockets()).size
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

        if (!socket.pollData || socket.pollData.sessionId !== sessionId) {
          return callback({
            success: false,
            message: 'You must join the poll first'
          });
        }

        const poll = await Poll.findOne({ 
          sessionId,
          expiresAt: { $gt: new Date() },
          isActive: true
        });

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
          { sessionId },
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
        io.to(`poll_${sessionId}`).emit('pollUpdate', {
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

        if (!socket.pollData || socket.pollData.userType !== 'admin') {
          return callback({
            success: false,
            message: 'Unauthorized'
          });
        }

        const poll = await Poll.findOneAndUpdate(
          { sessionId },
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
          sessionId, 
          socketId: socket.id 
        });

        callback({
          success: true,
          message: 'Poll closed'
        });

        // Notify all participants
        io.to(`poll_${sessionId}`).emit('pollClosed', {
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