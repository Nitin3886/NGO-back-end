import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from './models/User.js';
import NGO from './models/NGO.js';
import DonorProfile from './models/DonorProfile.js';
import Blog from './models/Blog.js';
import Comment from './models/Comment.js';
import Experience from './models/Experience.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    const allowed = [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ];
    // Allow any vercel.app domain
    if (allowed.includes(origin) || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB Cluster!'))
  .catch((err) => {
    console.error('\n' + '='.repeat(60));
    console.error('❌ MONGODB CONNECTION ERROR');
    console.error('='.repeat(60));
    if (err.name === 'MongooseServerSelectionError') {
      console.error('CAUSE: The server cannot reach your MongoDB Atlas cluster.');
      console.error('FIX: You must whitelist your current IP address in Atlas.');
      console.error('\nYOUR CURRENT IP: 49.156.90.204');
      console.error('\nSTEPS:');
      console.error('1. Go to https://cloud.mongodb.com/');
      console.error('2. Security > Network Access > Add IP Address');
      console.error('3. Add "49.156.90.204" and click Confirm.');
      console.error('4. Restart this server (npm start).');
    } else {
      console.error('MESSAGE:', err.message);
    }
    console.error('='.repeat(60) + '\n');
  });

// ==========================================
// JWT AUTH MIDDLEWARE
// ==========================================
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided.' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

// Optional auth — attaches user if token exists, but doesn't block
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) { /* ignore invalid token */ }
  }
  next();
};

// ==========================================
// HEALTH
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ==========================================
// AUTH ROUTES
// ==========================================
app.post('/api/register', async (req, res) => {
  try {
    // 1. Check DB Connection early
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ 
        message: 'Database connection is currently unavailable.', 
        error: 'The server is unable to reach MongoDB. Please check your IP whitelist in Atlas.' 
      });
    }

    const { fullName, email, password, role, organizationName, missionStatement } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'An account with this email already exists.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const savedUser = await new User({ fullName, email, passwordHash, role }).save();

    let profile = null;
    if (role === 'NGO_MANAGER') {
      profile = await new NGO({
        managerId: savedUser._id,
        organizationName: organizationName || `${fullName}'s NGO`,
        missionStatement: missionStatement || 'Making the world a better place.',
      }).save();
    } else {
      profile = await new DonorProfile({ userId: savedUser._id }).save();
    }

    const token = jwt.sign({ id: savedUser._id, email: savedUser.email, role: savedUser.role, fullName: savedUser.fullName }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Account created successfully!', token, user: { id: savedUser._id, fullName: savedUser.fullName, email: savedUser.email, role: savedUser.role, createdAt: savedUser.createdAt }, profile });
  } catch (error) {
    console.error('REGISTRATION ERROR:', error);
    res.status(500).json({ message: 'Error registering user', error: error.message, stack: error.stack });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid email or password.' });
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return res.status(401).json({ message: 'Invalid email or password.' });

    let profile = null;
    if (user.role === 'NGO_MANAGER') profile = await NGO.findOne({ managerId: user._id });
    else profile = await DonorProfile.findOne({ userId: user._id });

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role, fullName: user.fullName }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Login successful!', token, user: { id: user._id, fullName: user.fullName, email: user.email, role: user.role, createdAt: user.createdAt }, profile });
  } catch (error) {
    res.status(500).json({ message: 'Error logging in', error: error.message });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    let profile = null;
    if (user.role === 'NGO_MANAGER') profile = await NGO.findOne({ managerId: user._id });
    else profile = await DonorProfile.findOne({ userId: user._id });
    res.json({ user, profile });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user', error: error.message });
  }
});

app.put('/api/me', authMiddleware, async (req, res) => {
  try {
    const { fullName, email, organizationName, missionStatement, upiId, upiQrImage } = req.body;
    
    // Update User
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    
    if (fullName) user.fullName = fullName;
    if (email) user.email = email;
    await user.save();

    let profile = null;
    if (user.role === 'NGO_MANAGER') {
      profile = await NGO.findOne({ managerId: user._id });
      if (profile) {
        if (organizationName !== undefined) profile.organizationName = organizationName;
        if (missionStatement !== undefined) profile.missionStatement = missionStatement;
        if (upiId !== undefined) profile.upiId = upiId;
        if (upiQrImage !== undefined) profile.upiQrImage = upiQrImage;
        await profile.save();
      }
    } else {
      profile = await DonorProfile.findOne({ userId: user._id });
    }

    res.json({ message: 'Profile updated successfully', user, profile });
  } catch (error) {
    res.status(500).json({ message: 'Error updating user profile', error: error.message });
  }
});

// ==========================================
// POST / BLOG ROUTES
// ==========================================

// Create post (NGO only)
app.post('/api/posts', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'NGO_MANAGER') return res.status(403).json({ message: 'Only NGO managers can create posts.' });
    const { title, content, imageUrl } = req.body;
    const ngo = await NGO.findOne({ managerId: req.user.id });
    if (!ngo) return res.status(404).json({ message: 'NGO profile not found.' });

    const post = await new Blog({ ngoId: ngo._id, authorId: req.user.id, title, content, imageUrl: imageUrl || '' }).save();
    res.status(201).json({ message: 'Post published!', post });
  } catch (error) {
    res.status(500).json({ message: 'Error creating post', error: error.message });
  }
});

// Get all posts (feed) — with comment counts
app.get('/api/posts', optionalAuth, async (req, res) => {
  try {
    const posts = await Blog.find()
      .sort({ publishedAt: -1 })
      .populate({ path: 'ngoId', select: 'organizationName logoUrl isVerified upiId upiQrImage' })
      .populate({ path: 'authorId', select: 'fullName email' })
      .lean();

    // Attach comment count and whether current user liked
    const postsWithMeta = await Promise.all(posts.map(async (post) => {
      const commentCount = await Comment.countDocuments({ postId: post._id });
      const isLiked = req.user ? post.likes.some(id => id.toString() === req.user.id) : false;
      return { ...post, commentCount, isLiked, likeCount: post.likes.length };
    }));

    res.json({ posts: postsWithMeta });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching posts', error: error.message });
  }
});

// Get my NGO posts
app.get('/api/posts/mine', authMiddleware, async (req, res) => {
  try {
    const ngo = await NGO.findOne({ managerId: req.user.id });
    if (!ngo) return res.json({ posts: [] });
    const posts = await Blog.find({ ngoId: ngo._id }).sort({ publishedAt: -1 }).lean();
    const postsWithMeta = await Promise.all(posts.map(async (post) => {
      const commentCount = await Comment.countDocuments({ postId: post._id });
      return { ...post, commentCount, likeCount: post.likes.length };
    }));
    res.json({ posts: postsWithMeta });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching posts', error: error.message });
  }
});

// Like / Unlike toggle
app.patch('/api/posts/:id/like', authMiddleware, async (req, res) => {
  try {
    const post = await Blog.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found.' });
    const userId = req.user.id;
    const alreadyLiked = post.likes.some(id => id.toString() === userId);
    if (alreadyLiked) {
      post.likes = post.likes.filter(id => id.toString() !== userId);
    } else {
      post.likes.push(userId);
    }
    await post.save();
    res.json({ likeCount: post.likes.length, isLiked: !alreadyLiked });
  } catch (error) {
    res.status(500).json({ message: 'Error toggling like', error: error.message });
  }
});

// Share (increment counter)
app.patch('/api/posts/:id/share', async (req, res) => {
  try {
    const post = await Blog.findByIdAndUpdate(req.params.id, { $inc: { shares: 1 } }, { new: true });
    if (!post) return res.status(404).json({ message: 'Post not found.' });
    res.json({ shares: post.shares });
  } catch (error) {
    res.status(500).json({ message: 'Error sharing', error: error.message });
  }
});

// ==========================================
// COMMENT ROUTES
// ==========================================

// Get comments for a post
app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const comments = await Comment.find({ postId: req.params.id })
      .sort({ createdAt: -1 })
      .populate({ path: 'userId', select: 'fullName role' });
    res.json({ comments });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching comments', error: error.message });
  }
});

// Add a comment
app.post('/api/posts/:id/comments', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ message: 'Comment text is required.' });
    const comment = await new Comment({ postId: req.params.id, userId: req.user.id, text: text.trim() }).save();
    const populated = await Comment.findById(comment._id).populate({ path: 'userId', select: 'fullName role' });
    res.status(201).json({ comment: populated });
  } catch (error) {
    res.status(500).json({ message: 'Error adding comment', error: error.message });
  }
});

// ==========================================
// EXPERIENCE / REVIEW ROUTES
// ==========================================

// Get all experiences
app.get('/api/experiences', async (req, res) => {
  try {
    const experiences = await Experience.find()
      .sort({ createdAt: -1 })
      .populate({ path: 'donorId', select: 'fullName' });
    res.json({ experiences });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching experiences', error: error.message });
  }
});

// Create experience (Donor only)
app.post('/api/experiences', authMiddleware, async (req, res) => {
  try {
    const { ngoName, rating, text } = req.body;
    if (!ngoName || !rating || !text) return res.status(400).json({ message: 'All fields are required.' });
    const experience = await new Experience({ donorId: req.user.id, ngoName, rating: Number(rating), text }).save();
    const populated = await Experience.findById(experience._id).populate({ path: 'donorId', select: 'fullName' });
    res.status(201).json({ experience: populated });
  } catch (error) {
    res.status(500).json({ message: 'Error creating experience', error: error.message });
  }
});

// ==========================================
// NGO LISTING
// ==========================================
app.get('/api/ngos', async (req, res) => {
  try {
    const ngos = await NGO.find().populate({ path: 'managerId', select: 'fullName email' });
    res.json({ ngos });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching NGOs', error: error.message });
  }
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use! Kill the existing process and retry.\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
