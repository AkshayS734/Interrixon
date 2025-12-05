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

export async function createPoll({ sessionId, question, type, options, duration, createdBy }) {
  // If sessionId provided, validate it. Otherwise generate a unique 6-char sessionId.
  const originalSessionIdProvided = Boolean(sessionId);
  if (sessionId && !isValidIdentifier(sessionId)) throw new Error('Invalid session ID format.');
  if (!question || !type) throw new Error('Question and poll type are required.');

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

  question = sanitizeText(question.trim());

  if (!['multiple-choice', 'yes-no', 'open-text', 'rating'].includes(type)) {
    throw new Error('Invalid poll type.');
  }

  // Handle options per poll type
  if (type === 'multiple-choice') {
    options = cleanOptions(options);
    if (options.length < 2) throw new Error('At least 2 options required.');
    if (new Set(options).size !== options.length) throw new Error('Poll options must be unique.');
  } else if (type === 'yes-no') {
    // enforce Yes/No options server-side
    options = ['Yes', 'No'];
  } else if (type === 'rating') {
    // rating polls don't require explicit options; responses are numeric
    options = [];
  } else if (type === 'open-text') {
    options = [];
  }

  if (!duration || typeof duration !== 'number' || duration < 1) {
    throw new Error('Poll duration must be a positive number.');
  }

  const pollData = {
    sessionId,
    question,
    type,
    options: type === 'open-text' ? [] : options,
    results: type === 'open-text' ? [] : options.map(option => ({ option, votes: 0 })),
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

export async function submitVote({ sessionId, option, userId }) {
  if (!isValidIdentifier(sessionId)) throw new Error('Invalid session ID format.');
  if (!sessionId || !userId) throw new Error('Session ID and user ID are required.');

  const poll = await Poll.findOne(buildPollQuery(sessionId));
  if (!poll) throw new Error('Poll not found.');
  if (poll.expiresAt && new Date() > poll.expiresAt) throw new Error('Poll has expired.');
  if (poll.voters.includes(userId)) throw new Error('You have already voted.');

  if (poll.type === 'open-text') {
    if (!option || option.trim().length === 0) throw new Error('Response text is required.');
    poll.responses.push({
      userId,
      response: sanitizeText(option.trim()),
      timestamp: new Date()
    });
  } else {
    option = sanitizeText(option.trim());
    const result = poll.results.find(r => r.option === option);
    if (!result) throw new Error('Option not found.');
    result.votes += 1;
  }

  poll.voters.push(userId);
  await poll.save();
  return poll;
}

export async function getPoll({ sessionId }) {
  if (!isValidIdentifier(sessionId)) throw new Error('Invalid session ID format.');
  const poll = await Poll.findOne(buildPollQuery(sessionId));
  if (!poll) throw new Error('Poll not found.');
  return poll;
}