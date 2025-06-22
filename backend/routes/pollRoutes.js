import express from 'express';
import { 
  createPoll, 
  vote, 
  getPoll, 
  getResults, 
  getAdminPolls, 
  deletePoll, 
  closePoll 
} from '../controllers/pollController.js';
import { authenticateToken } from '../middleware/auth.js';
import { validate, schemas, pollLimiter } from '../middleware/validation.js';

const router = express.Router();

// Public routes
router.get('/:sessionId', getPoll);
router.get('/:sessionId/results', getResults);
router.post('/vote', validate(schemas.vote), vote);

// Admin routes (require authentication)
router.post('/create', 
  authenticateToken,
  pollLimiter,
  validate(schemas.createPoll),
  createPoll
);

router.get('/admin/polls', 
  authenticateToken,
  getAdminPolls
);

router.delete('/:sessionId', 
  authenticateToken,
  deletePoll
);

router.patch('/:sessionId/close', 
  authenticateToken,
  closePoll
);

export default router;