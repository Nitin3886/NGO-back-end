import mongoose from 'mongoose';

// Represents the Company / NGO tied to a Manager
const NGOSchema = new mongoose.Schema({
  managerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  organizationName: {
    type: String,
    required: true
  },
  missionStatement: {
    type: String,
    default: ''
  },
  logoUrl: {
    type: String,
    default: ''
  },
  upiId: {
    type: String,
    default: ''
  },
  upiQrImage: {
    type: String,
    default: ''
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  totalRaised: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const NGO = mongoose.model('NGO', NGOSchema);
export default NGO;
