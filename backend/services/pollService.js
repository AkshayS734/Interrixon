import Poll from '../models/Poll.js';
import validator from 'validator';

function cleanOptions(options) {
  return options
    .map(o => (typeof o === 'string' ? validator.escape(o.trim()) : ''))
    .filter(o => o.length > 0);
}

function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && /^[A-F0-9]{24}$/i.test(sessionId);
}

export async function createPoll({ sessionId, question, type, options, duration }) {
  if (!isValidSessionId(sessionId)) throw new Error('Invalid session ID format.');
  if (!sessionId || !question || !type) throw new Error('SessionId, question, and poll type are required.');

  question = validator.escape(question.trim());

  if (!['multiple-choice', 'yes-no', 'open-text', 'rating'].includes(type)) {
    throw new Error('Invalid poll type.');
  }

  if (type !== 'open-text') {
    options = cleanOptions(options);
    if (options.length < 2) throw new Error('At least 2 options required.');
    if (new Set(options).size !== options.length) throw new Error('Poll options must be unique.');
  }

  if (!duration || typeof duration !== 'number' || duration < 1) {
    throw new Error('Poll duration must be a positive number.');
  }

  await Poll.findOneAndDelete({ sessionId });

  const pollData = {
    sessionId,
    question,
    type,
    options: type === 'open-text' ? [] : options,
    results: type === 'open-text' ? [] : options.map(option => ({ option, votes: 0 })),
    openResponses: [],
    expiresAt: new Date(Date.now() + duration * 1000),
    voters: []
  };

  const poll = new Poll(pollData);
  return await poll.save();
}

export async function submitVote({ sessionId, option, userId }) {
  if (!isValidSessionId(sessionId)) throw new Error('Invalid session ID format.');
  if (!sessionId || !userId) throw new Error('Session ID and user ID are required.');

  const poll = await Poll.findOne({ sessionId });
  if (!poll) throw new Error('Poll not found.');
  if (poll.expiresAt && new Date() > poll.expiresAt) throw new Error('Poll has expired.');
  if (poll.voters.includes(userId)) throw new Error('You have already voted.');

  if (poll.type === 'open-text') {
    if (!option || option.trim().length === 0) throw new Error('Response text is required.');
    poll.openResponses.push(validator.escape(option.trim()));
  } else {
    option = validator.escape(option.trim());
    const result = poll.results.find(r => r.option === option);
    if (!result) throw new Error('Option not found.');
    result.votes += 1;
  }

  poll.voters.push(userId);
  await poll.save();
  return poll;
}

export async function getPoll({ sessionId }) {
  if (!isValidSessionId(sessionId)) throw new Error('Invalid session ID format.');
  const poll = await Poll.findOne({ sessionId });
  if (!poll) throw new Error('Poll not found.');
  return poll;
}