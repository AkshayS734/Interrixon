import Poll from '../models/Poll.js';
import logger from '../utils/logger.js';
import mongoose from 'mongoose';
import { createPoll as serviceCreatePoll, submitVote as serviceSubmitVote } from '../services/pollService.js';

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

export const createPoll = async (req, res) => {
  try {
    const { question, type, options, duration } = req.body;
    const createdBy = req.admin._id;

    const poll = await serviceCreatePoll({ question, type, options, duration, createdBy });

    logger.info('Poll created', {
      sessionId: poll.sessionId,
      adminId: createdBy,
      type,
      duration
    });

    res.status(201).json({
      success: true,
      poll: {
        sessionId: poll.sessionId,
        systemId: poll._id.toString(),
        question: poll.question,
        type: poll.type,
        options: poll.options,
        expiresAt: poll.expiresAt
      }
    });
  } catch (error) {
    logger.error('Poll creation error', {
      error: error.message,
      adminId: req.admin?._id
    });
    res.status(500).json({ success: false, message: error.message || 'Failed to create poll' });
  }
};

export const vote = async (req, res) => {
  try {
    const { sessionId, vote: voteValue, userId } = req.body;
    if (!isValidIdentifier(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const updatedPoll = await serviceSubmitVote({ sessionId, option: voteValue, userId });

    logger.info('Vote recorded', {
      sessionId,
      userId,
      vote: updatedPoll.type === 'multiple-choice' || updatedPoll.type === 'yes-no' ? voteValue : '[response]'
    });

    res.json({ success: true, message: 'Vote recorded successfully', results: updatedPoll.results });
  } catch (error) {
    logger.error('Vote error', { error: error.message, sessionId: req.body.sessionId });
    res.status(500).json({ success: false, message: error.message || 'Failed to record vote' });
  }
};

export const getPoll = async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!isValidIdentifier(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const poll = await Poll.findOne({
      ...buildPollQuery(sessionId),
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
    if (!isValidIdentifier(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const poll = await Poll.findOne(buildPollQuery(sessionId));

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
      .select('sessionId question type voters expiresAt isActive createdAt');

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
      $and: [ buildPollQuery(sessionId), { createdBy: adminId } ]
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
      { $and: [ buildPollQuery(sessionId), { createdBy: adminId } ] },
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