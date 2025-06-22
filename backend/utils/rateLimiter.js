class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  check(identifier) {
    const now = Date.now();
    const windowStart = now - this.windowMs * 1000;

    // Clean up old entries
    this.cleanup(windowStart);

    // Get current requests for this identifier
    const userRequests = this.requests.get(identifier) || [];
    
    // Filter requests within current window
    const validRequests = userRequests.filter(timestamp => timestamp > windowStart);

    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    // Add current request
    validRequests.push(now);
    this.requests.set(identifier, validRequests);
    
    return true;
  }

  cleanup(windowStart) {
    for (const [identifier, requests] of this.requests.entries()) {
      const validRequests = requests.filter(timestamp => timestamp > windowStart);
      if (validRequests.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, validRequests);
      }
    }
  }
}

export const createRateLimiter = (maxRequests, windowSeconds) => {
  return new RateLimiter(maxRequests, windowSeconds);
};

// Export default limiters
export const socketLimiters = {
  vote: createRateLimiter(10, 60), // 10 votes per minute
  join: createRateLimiter(20, 60), // 20 joins per minute
  message: createRateLimiter(30, 60) // 30 messages per minute
};