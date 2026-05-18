import mongoose from 'mongoose';

const DonorProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  totalDonated: {
    type: Number,
    default: 0
  },
  savedNGOs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'NGO'
  }],
  preferences: {
    type: [String],
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const DonorProfile = mongoose.model('DonorProfile', DonorProfileSchema);
export default DonorProfile;
