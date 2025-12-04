import Joi from 'joi';
import rateLimit from 'express-rate-limit';

// Validation schemas
export const schemas = {
  adminSignup: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])')).required()
      .messages({
        'string.pattern.base': 'Password must contain at least 8 characters with uppercase, lowercase, number and special character'
      })
  }),
  
  adminLogin: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),
  
  createPoll: Joi.object({
    question: Joi.string().max(500).required(),
    type: Joi.string().valid('multiple-choice', 'yes-no', 'open-text', 'rating').required(),
    options: Joi.array().items(Joi.string().max(200)).min(2).when('type', {
      is: 'multiple-choice',
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    duration: Joi.number().min(30).max(3600).default(300)
  }),
  
  vote: Joi.object({
    // sessionId can be either a 6-char user-facing code or a 24-char ObjectId string
    sessionId: Joi.alternatives().try(
      Joi.string().alphanum().length(6),
      Joi.string().hex().length(24)
    ).required(),
    vote: Joi.alternatives().try(
      Joi.string().max(200),
      Joi.number().min(1).max(5)
    ).required(),
    userId: Joi.string().required()
  })
};

// Validation middleware
export const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }
    next();
  };
};

// Rate limiting
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

export const pollLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 polls per minute
  message: {
    success: false,
    message: 'Too many poll creation attempts'
  }
});