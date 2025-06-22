import Poll from '../models/Poll.js';
import logger from '../utils/logger.js';
import mongoose from 'mongoose';

export const createPoll = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    const { question, type, options, duration } = req.body;
    
    // Generate unique session ID
    let sessionId;
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 5) {
      sessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const existingPoll = await Poll.findOne({ sessionId }).session(session);
      if (!existingPoll) {
        isUnique = true;
      }
      attempts++;
    }
    
    if (!isUnique) {
      throw new Error('Unable to generate unique session ID');
    }

    const expiresAt = new Date(Date.now() + duration * 1000);
    
    const poll = new Poll({
      sessionId,
      question: question.trim(),
      type,
      options: type === 'multiple-choice' ? options.map(opt => opt.trim()) : [],
      results: type === 'multiple-choice' ? 
        options.map(option => ({ option: option.trim(), votes: 0 })) : 
        type === 'yes-no' ?
        [{ option: 'Yes', votes: 0 }, { option: 'No', votes: 0 }] :
        [],
      expiresAt,
      voters: [],
      responses: [],
      createdBy: req.admin._id,
      createdAt: new Date()
    });

    await poll.save({ session });
    await session.commitTransaction();
    
    logger.info('Poll created', { 
      sessionId, 
      adminId: req.admin._id,
      type,
      duration 
    });

    res.status(201).json({
      success: true,
      poll: {
        sessionId: poll.sessionId,
        question: poll.question,
        type: poll.type,
        options: poll.options,
        expiresAt: poll.expiresAt
      }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Poll creation error', { 
      error: error.message,
      adminId: req.admin._id 
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to create poll'
    });
  } finally {
    session.endSession();
  }
};

export const vote = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    const { sessionId, vote, userId } = req.body;
    
    const poll = await Poll.findOne({ 
      sessionId,
      expiresAt: { $gt: new Date() },
      isActive: true
    }).session(session);
    
    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Poll not found or expired'
      });
    }
    
    // Check if user already voted
    if (poll.voters.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: 'You have already voted in this poll'
      });
    }
    
    // Process vote based on poll type
    let updateQuery = {};
    
    if (poll.type === 'multiple-choice' || poll.type === 'yes-no') {
      const optionIndex = poll.results.findIndex(r => r.option === vote);
      if (optionIndex === -1) {
        return res.status(400).json({
          success: false,
          message: 'Invalid option selected'
        });
      }
      
      updateQuery = {
        $inc: { [`results.${optionIndex}.votes`]: 1 },
        $push: { voters: userId }
      };
    } else {
      // For other poll types, store the vote
      updateQuery = {
        $push: { 
          voters: userId,
          responses: { userId, response: vote, timestamp: new Date() }
        }
      };
    }
    
    const updatedPoll = await Poll.findOneAndUpdate(
      { sessionId },
      updateQuery,
      { new: true, session }
    );
    
    await session.commitTransaction();
    
    logger.info('Vote recorded', { 
      sessionId, 
      userId, 
      vote: poll.type === 'multiple-choice' || poll.type === 'yes-no' ? vote : '[response]'
    });
    
    res.json({
      success: true,
      message: 'Vote recorded successfully',
      results: updatedPoll.results
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Vote error', { 
      error: error.message,
      sessionId: req.body.sessionId 
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to record vote'
    });
  } finally {
    session.endSession();
  }
};

export const getPoll = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId || sessionId.length !== 6) {
      return res.status(400).json({
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
      return res.status(404).json({
        success: false,
        message: 'Poll not found or expired'
      });
    }

    logger.info('Poll retrieved', { sessionId });

    res.json({
      success: true,
      poll: {
        sessionId: poll.sessionId,
        question: poll.question,
        type: poll.type,
        options: poll.options,
        expiresAt: poll.expiresAt,
        totalVotes: poll.voters.length,
        isActive: poll.isActive
      }
    });

  } catch (error) {
    logger.error('Get poll error', { 
      error: error.message,
      sessionId: req.params.sessionId 
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve poll'
    });
  }
};

export const getResults = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId || sessionId.length !== 6) {
      return res.status(400).json({
        success: false,
        message: 'Invalid session ID'
      });
    }

    const poll = await Poll.findOne({ sessionId });

    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Poll not found'
      });
    }

    logger.info('Poll results retrieved', { sessionId });

    // Prepare results based on poll type
    let results = {};
    
    if (poll.type === 'multiple-choice' || poll.type === 'yes-no') {
      results = {
        type: poll.type,
        question: poll.question,
        options: poll.results,
        totalVotes: poll.voters.length,
        isActive: poll.isActive && poll.expiresAt > new Date(),
        expiresAt: poll.expiresAt
      };
    } else if (poll.type === 'open-text') {
      results = {
        type: poll.type,
        question: poll.question,
        responses: poll.responses || [],
        totalResponses: poll.voters.length,
        isActive: poll.isActive && poll.expiresAt > new Date(),
        expiresAt: poll.expiresAt
      };
    } else if (poll.type === 'rating') {
      // Calculate average rating
      const ratings = poll.responses || [];
      const totalRating = ratings.reduce((sum, r) => sum + parseFloat(r.response), 0);
      const averageRating = ratings.length > 0 ? (totalRating / ratings.length).toFixed(1) : 0;
      
      // Count ratings distribution
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      ratings.forEach(r => {
        const rating = parseInt(r.response);
        if (rating >= 1 && rating <= 5) {
          distribution[rating]++;
        }
      });

      results = {
        type: poll.type,
        question: poll.question,
        averageRating: parseFloat(averageRating),
        distribution,
        totalRatings: ratings.length,
        isActive: poll.isActive && poll.expiresAt > new Date(),
        expiresAt: poll.expiresAt
      };
    }

    res.json({
      success: true,
      results
    });

  } catch (error) {
    logger.error('Get results error', { 
      error: error.message,
      sessionId: req.params.sessionId 
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve results'
    });
  }
};

export const getAdminPolls = async (req, res) => {
  try {
    const adminId = req.admin._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const polls = await Poll.find({ createdBy: adminId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('sessionId question type voters.length expiresAt isActive createdAt');

    const totalPolls = await Poll.countDocuments({ createdBy: adminId });

    logger.info('Admin polls retrieved', { 
      adminId, 
      page, 
      limit, 
      total: totalPolls 
    });

    res.json({
      success: true,
      polls: polls.map(poll => ({
        sessionId: poll.sessionId,
        question: poll.question,
        type: poll.type,
        totalVotes: poll.voters.length,
        isActive: poll.isActive && poll.expiresAt > new Date(),
        expiresAt: poll.expiresAt,
        createdAt: poll.createdAt
      })),
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(totalPolls / limit),
        totalPolls
      }
    });

  } catch (error) {
    logger.error('Get admin polls error', { 
      error: error.message,
      adminId: req.admin._id 
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve polls'
    });
  }
};

export const deletePoll = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const adminId = req.admin._id;

    const poll = await Poll.findOneAndDelete({ 
      sessionId, 
      createdBy: adminId 
    });

    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Poll not found or you do not have permission to delete it'
      });
    }

    logger.info('Poll deleted', { sessionId, adminId });

    res.json({
      success: true,
      message: 'Poll deleted successfully'
    });

  } catch (error) {
    logger.error('Delete poll error', { 
      error: error.message,
      sessionId: req.params.sessionId,
      adminId: req.admin._id 
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to delete poll'
    });
  }
};

export const closePoll = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const adminId = req.admin._id;

    const poll = await Poll.findOneAndUpdate(
      { sessionId, createdBy: adminId },
      { 
        isActive: false,
        closedAt: new Date()
      },
      { new: true }
    );

    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Poll not found or you do not have permission to close it'
      });
    }

    logger.info('Poll closed', { sessionId, adminId });

    res.json({
      success: true,
      message: 'Poll closed successfully',
      poll: {
        sessionId: poll.sessionId,
        isActive: poll.isActive,
        closedAt: poll.closedAt
      }
    });

  } catch (error) {
    logger.error('Close poll error', { 
      error: error.message,
      sessionId: req.params.sessionId,
      adminId: req.admin._id 
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to close poll'
    });
  }
};