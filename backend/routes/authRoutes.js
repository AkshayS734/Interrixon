import express from 'express';
import { signup, login, logout } from '../controllers/authController.js';
import { validate, schemas, authLimiter } from '../middleware/validation.js';

const router = express.Router();

router.post('/signup', 
  authLimiter,
  validate(schemas.adminSignup), 
  signup
);

router.post('/login', 
  authLimiter,
  validate(schemas.adminLogin), 
  login
);

router.post('/logout', logout);

export default router;