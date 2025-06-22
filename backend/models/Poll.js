import mongoose from 'mongoose';

const pollSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  question: {
    type: String,
    required: true,
    maxlength: 500
  },
  type: {
    type: String,
    required: true,
    enum: ['multiple-choice', 'yes-no', 'open-text', 'rating']
  },
  options: [String],
  results: [{
    option: String,
    votes: { type: Number, default: 0 }
  }],
  responses: [{
    userId: String,
    response: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now }
  }],
  voters: {
    type: [String],
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for better query performance
pollSchema.index({ sessionId: 1, expiresAt: 1 });
pollSchema.index({ createdBy: 1, createdAt: -1 });
pollSchema.index({ isActive: 1, expiresAt: 1 });

export default mongoose.model('Poll', pollSchema);