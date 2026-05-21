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
import dns from 'dns';
// Change DNS
dns.setServers(["1.1.1.1", "8.8.8.8"]);

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

// MongoDB Connection + Auto-seed Admin
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB Cluster!');
    // Auto-create admin account if none exists
    try {
      const existing = await User.findOne({ role: 'ADMIN' });
      if (!existing) {
        const passwordHash = await bcrypt.hash('admin123456', 10);
        await new User({ fullName: 'Admin', email: 'admin@ngoconnect.com', passwordHash, role: 'ADMIN' }).save();
        console.log('');
        console.log('🔑 ====================================');
        console.log('🔑  ADMIN ACCOUNT AUTO-CREATED');
        console.log('🔑  Email:    admin@ngoconnect.com');
        console.log('🔑  Password: admin123456');
        console.log('🔑 ====================================');
        console.log('');
      } else {
        console.log('ℹ️  Admin account already exists:', existing.email);
      }
    } catch (e) {
      console.error('⚠️  Admin seed failed:', e.message);
    }
  })
  .catch((err) => {
    console.error('\n' + '='.repeat(60));
    console.error('❌ MONGODB CONNECTION ERROR');
    console.error('='.repeat(60));
    if (err.name === 'MongooseServerSelectionError') {
      console.error('CAUSE: The server cannot reach your MongoDB Atlas cluster.');
      console.error('FIX: You must whitelist your current IP address in Atlas.');
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
// RAG / AI QUERY (GEMINI REST API)
// ==========================================
app.post('/api/ngo/query', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'NGO_MANAGER') {
      return res.status(403).json({ message: 'Only NGO managers can query data.' });
    }

    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ message: 'Query string is required.' });
    }

    // 1. Fetch relevant context data from MongoDB
    const ngo = await NGO.findOne({ managerId: req.user.id });
    if (!ngo) return res.status(404).json({ message: 'NGO profile not found.' });

    const posts = await Blog.find({ ngoId: ngo._id }).lean();
    
    // Create a simplified context string
    const contextData = {
      ngoName: ngo.organizationName,
      totalRaised: ngo.totalRaised || 0,
      postCount: posts.length,
      posts: posts.map(p => ({
        title: p.title,
        likes: p.likes?.length || 0,
        publishedAt: p.publishedAt,
        contentSnippet: p.content.substring(0, 100) + '...'
      }))
    };

    const apiKey = process.env.GEMINI_API_KEY;

    // 2. Fallback if no API key is provided
    if (!apiKey) {
      // Fetch platform-wide static data as requested by user
      const totalNGOs = await NGO.countDocuments();
      const totalDonors = await User.countDocuments({ role: 'DONOR' });
      const totalUsers = await User.countDocuments();
      const totalPlatformPosts = await Blog.countDocuments();
      const totalComments = await Comment.countDocuments();

      return res.json({ 
        answer: `**[Static Data Fallback]** It looks like the Gemini API is not connected. Here is the static platform data from MongoDB instead:\n\n- **Total NGO Managers/Organizations**: ${totalNGOs}\n- **Total Donors**: ${totalDonors}\n- **Total Platform Members**: ${totalUsers}\n- **Total Posts**: ${totalPlatformPosts}\n- **Total Comments**: ${totalComments}\n\n*(Your specific NGO has ${posts.length} posts and raised $${ngo.totalRaised || 0})*\n\nTo enable the real AI chat for natural language queries, add your \`GEMINI_API_KEY\` to the backend \`.env\` file.` 
      });
    }

    // 3. Call Gemini REST API
    const prompt = `You are a helpful AI assistant for an NGO Manager. Answer the manager's query based ONLY on the following data context. Keep the answer concise and professional.
    
Context Data:
${JSON.stringify(contextData, null, 2)}

Manager's Query: ${query}

Answer:`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to call Gemini API');
    }

    const answer = data.candidates[0].content.parts[0].text;

    res.json({ answer });
  } catch (error) {
    console.error('RAG Query Error:', error);
    res.status(500).json({ message: 'Error processing AI query', error: error.message });
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

// ==========================================
// ADMIN MIDDLEWARE
// ==========================================
const adminMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided.' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Admin access required.' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

// ==========================================
// ADMIN ROUTES
// ==========================================

// GET /api/admin/stats — Overview stats for admin dashboard
app.get('/api/admin/stats', adminMiddleware, async (req, res) => {
  try {
    const [totalNGOs, totalDonors, totalPosts, totalComments, totalExperiences] = await Promise.all([
      NGO.countDocuments(),
      User.countDocuments({ role: 'DONOR' }),
      Blog.countDocuments(),
      Comment.countDocuments(),
      Experience.countDocuments(),
    ]);

    // Monthly post counts for the last 12 months
    const now = new Date();
    const monthlyPosts = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const count = await Blog.countDocuments({ publishedAt: { $gte: start, $lt: end } });
      monthlyPosts.push({
        month: start.toLocaleString('default', { month: 'short' }),
        count,
        year: start.getFullYear(),
      });
    }

    // Monthly donor registrations for the last 12 months
    const monthlyDonors = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const count = await User.countDocuments({ role: 'DONOR', createdAt: { $gte: start, $lt: end } });
      monthlyDonors.push({ month: start.toLocaleString('default', { month: 'short' }), count });
    }

    res.json({ totalNGOs, totalDonors, totalPosts, totalComments, totalExperiences, monthlyPosts, monthlyDonors });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching admin stats', error: error.message });
  }
});

// GET /api/admin/ngos — All NGOs with post count, comment count
app.get('/api/admin/ngos', adminMiddleware, async (req, res) => {
  try {
    const ngos = await NGO.find()
      .populate({ path: 'managerId', select: 'fullName email createdAt' })
      .lean();

    const ngosWithStats = await Promise.all(ngos.map(async (ngo) => {
      const posts = await Blog.find({ ngoId: ngo._id }).lean();
      const postCount = posts.length;
      const totalLikes = posts.reduce((sum, p) => sum + (p.likes?.length || 0), 0);
      const totalShares = posts.reduce((sum, p) => sum + (p.shares || 0), 0);
      const totalComments = await Comment.countDocuments({ postId: { $in: posts.map(p => p._id) } });
      const recentPost = posts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];
      return { ...ngo, postCount, totalLikes, totalShares, totalComments, recentPost };
    }));

    res.json({ ngos: ngosWithStats });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching admin NGO data', error: error.message });
  }
});

// GET /api/admin/posts — All posts for admin
app.get('/api/admin/posts', adminMiddleware, async (req, res) => {
  try {
    const posts = await Blog.find()
      .sort({ publishedAt: -1 })
      .limit(20)
      .populate({ path: 'ngoId', select: 'organizationName isVerified' })
      .populate({ path: 'authorId', select: 'fullName email' })
      .lean();

    const postsWithMeta = await Promise.all(posts.map(async (post) => {
      const commentCount = await Comment.countDocuments({ postId: post._id });
      return { ...post, commentCount, likeCount: post.likes?.length || 0 };
    }));

    res.json({ posts: postsWithMeta });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching admin posts', error: error.message });
  }
});

// PATCH /api/admin/ngos/:id/verify — Toggle NGO verified status
app.patch('/api/admin/ngos/:id/verify', adminMiddleware, async (req, res) => {
  try {
    const ngo = await NGO.findById(req.params.id);
    if (!ngo) return res.status(404).json({ message: 'NGO not found.' });
    ngo.isVerified = !ngo.isVerified;
    await ngo.save();
    res.json({ message: `NGO ${ngo.isVerified ? 'verified' : 'unverified'} successfully.`, isVerified: ngo.isVerified });
  } catch (error) {
    res.status(500).json({ message: 'Error updating NGO', error: error.message });
  }
});

// POST /api/admin/register — Create admin account (one-time setup, no auth required)
// Protected by a secret key in body
app.post('/api/admin/register', async (req, res) => {
  try {
    const { fullName, email, password, adminSecret } = req.body;
    if (adminSecret !== (process.env.ADMIN_SECRET || 'ngo_admin_secret_2026')) {
      return res.status(403).json({ message: 'Invalid admin secret.' });
    }
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered.' });
    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await new User({ fullName, email, passwordHash, role: 'ADMIN' }).save();
    const token = jwt.sign({ id: admin._id, email: admin.email, role: admin.role, fullName: admin.fullName }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Admin account created.', token, user: { id: admin._id, fullName: admin.fullName, email: admin.email, role: admin.role } });
  } catch (error) {
    res.status(500).json({ message: 'Error creating admin', error: error.message });
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
