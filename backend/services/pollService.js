import Poll from '../models/Poll.js';
import validator from 'validator';
import mongoose from 'mongoose';

function cleanOptions(options) {
  return options
    .map(o => (typeof o === 'string' ? sanitizeText(o.trim()) : ''))
    .filter(o => o.length > 0);
}

// Escape potentially dangerous characters except keep forward-slash '/' as-is
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  // validator.escape converts '/' to HTML entity; restore it so user-entered slashes stay
  return validator.escape(str).replace(/&#x2F;|&#47;/g, '/');
}

function isValidIdentifier(id) {
  if (typeof id !== 'string') return false;
  const sixChar = /^[A-Z0-9]{6}$/i;
  const objectId = /^[a-fA-F0-9]{24}$/;
  return sixChar.test(id) || objectId.test(id);
}

function buildPollQuery(id) {
  // If 24-char hex, allow matching by _id OR sessionId; otherwise match sessionId only
  const objectId = /^[a-fA-F0-9]{24}$/;
  if (objectId.test(id)) {
    try {
      return { $or: [{ sessionId: id }, { _id: mongoose.Types.ObjectId(id) }] };
    } catch (e) {
      // fallback to sessionId only
      return { sessionId: id };
    }
  }
  return { sessionId: id };
}

export async function createPoll({ sessionId, questions, duration, createdBy, pollName }) {
  // If sessionId provided, validate it. Otherwise generate a unique 6-char sessionId.
  const originalSessionIdProvided = Boolean(sessionId);
  if (sessionId && !isValidIdentifier(sessionId)) throw new Error('Invalid session ID format.');
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    throw new Error('At least one question is required.');
  }
  
  // Validate each question
  questions.forEach((q, idx) => {
    if (!q.question || !q.type) {
      throw new Error(`Question ${idx + 1}: question text and type are required.`);
    }
    if (!['multiple-choice', 'yes-no', 'open-text', 'rating'].includes(q.type)) {
      throw new Error(`Question ${idx + 1}: Invalid poll type.`);
    }
  });

  // Generate a unique 6-character sessionId when not supplied
  if (!sessionId) {
    let attempts = 0;
    let isUnique = false;
    while (!isUnique && attempts < 10) {
      const candidate = Math.random().toString(36).substring(2, 8).toUpperCase();
      // check DB for existing
      // eslint-disable-next-line no-await-in-loop
      const existing = await Poll.findOne({ sessionId: candidate }).select('_id').lean();
      if (!existing) {
        sessionId = candidate;
        isUnique = true;
        break;
      }
      attempts += 1;
    }
    if (!isUnique) throw new Error('Unable to generate a unique session ID.');
  }

  // Process and validate each question
  const processedQuestions = questions.map((q) => {
    const sanitizedQuestion = sanitizeText(q.question.trim());
    const type = q.type;
    let options = q.options || [];

    if (type === 'multiple-choice') {
      options = cleanOptions(options);
      if (options.length < 2) throw new Error('At least 2 options required for multiple-choice.');
      if (new Set(options).size !== options.length) throw new Error('Poll options must be unique.');
    } else if (type === 'yes-no') {
      options = ['Yes', 'No'];
    } else if (type === 'rating' || type === 'open-text') {
      options = [];
    }

    return {
      question: sanitizedQuestion,
      type,
      options,
      results: type === 'open-text' || type === 'rating' ? [] : options.map(option => ({ option, votes: 0 }))
    };
  });

  if (!duration || typeof duration !== 'number' || duration < 1) {
    throw new Error('Poll duration must be a positive number.');
  }

  // Ensure no existing poll uses the same sessionId
  const existing = await Poll.findOne({ sessionId }).select('_id').lean();
  if (existing) throw new Error('SessionId already in use.');

  const pollData = {
    sessionId,
    pollName: pollName || 'Untitled Poll',
    questions: processedQuestions,
    responses: [],
    expiresAt: new Date(Date.now() + duration * 1000),
    voters: []
  };

  pollData.createdBy = createdBy;
  
  // Try saving; if a duplicate key for sessionId occurs (race condition),
  // retry with a new generated sessionId when the id was not provided by the caller.
  const maxSaveAttempts = 10;
  for (let attempt = 0; attempt < maxSaveAttempts; attempt++) {
    try {
      const poll = new Poll(pollData);
      return await poll.save();
    } catch (err) {
      // Duplicate key error (E11000) for sessionId
      const isDupKey = err && (err.code === 11000 || err.code === 11001);
      const dupSession = isDupKey && err.keyPattern && err.keyPattern.sessionId;
      if (isDupKey && (dupSession || (err.message && err.message.includes('sessionId')))) {
        if (originalSessionIdProvided) {
          // Caller explicitly supplied sessionId, surface conflict
          throw new Error('SessionId already in use.');
        }
        // otherwise generate a new sessionId and retry
        const candidate = Math.random().toString(36).substring(2, 8).toUpperCase();
        // ensure format
        if (!isValidIdentifier(candidate)) {
          continue;
        }
        pollData.sessionId = candidate;
        // try next iteration
        continue;
      }
      // Other errors bubble up
      throw err;
    }
  }
  throw new Error('Unable to create poll after several attempts due to sessionId conflicts.');
}

export async function submitVote({ sessionId, questionId, option, userId }) {
  if (!isValidIdentifier(sessionId)) throw new Error('Invalid session ID format.');
  if (!sessionId || !questionId || !userId) throw new Error('Session ID, question ID, and user ID are required.');

  const poll = await Poll.findOne(buildPollQuery(sessionId));
  if (!poll) throw new Error('Poll not found.');
  if (poll.expiresAt && new Date() > poll.expiresAt) throw new Error('Poll has expired.');

  // Find the question
  const question = poll.questions.find(q => q._id.toString() === questionId);
  if (!question) throw new Error('Question not found.');

  // Check if user has already voted on THIS specific question
  const alreadyVotedOnThisQuestion = poll.responses.some(
    r => r.userId === userId && r.questionId.toString() === questionId
  );
  if (alreadyVotedOnThisQuestion) throw new Error('You have already voted on this question.');

  const type = question.type;

  if (type === 'open-text') {
    if (!option || option.trim().length === 0) throw new Error('Response text is required.');
    poll.responses.push({
      userId,
      questionId,
      response: sanitizeText(option.trim()),
      timestamp: new Date()
    });
  } else if (type === 'rating') {
    const rating = parseInt(option, 10);
    if (isNaN(rating) || rating < 1 || rating > 5) throw new Error('Rating must be between 1 and 5.');
    poll.responses.push({
      userId,
      questionId,
      response: rating,
      timestamp: new Date()
    });
    // Update results (array of response objects for aggregation)
    question.results.push({ response: rating });
  } else {
    // multiple-choice or yes-no
    option = sanitizeText(option.trim());
    const result = question.results.find(r => r.option === option);
    if (!result) throw new Error('Option not found.');
    result.votes += 1;
    poll.responses.push({
      userId,
      questionId,
      response: option,
      timestamp: new Date()
    });
  }

  // Track that user has voted on at least one question
  // Only add to voters if they haven't voted on ANY question yet
  if (!poll.voters.includes(userId)) {
    poll.voters.push(userId);
  }

  await poll.save();
  return poll;
}

export async function getPoll({ sessionId }) {
  if (!isValidIdentifier(sessionId)) throw new Error('Invalid session ID format.');
  const poll = await Poll.findOne(buildPollQuery(sessionId));
  if (!poll) throw new Error('Poll not found.');
  return poll;
}