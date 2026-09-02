import User from '../models/User.js';

// @desc    Register a new user / farmer
// @route   POST /api/auth/register
// @access  Public
export const register = async (req, res) => {
  try {
    const { name, phoneNumber, password, preferredLanguage } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!phoneNumber || !phoneNumber.trim()) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const userExists = await User.findOne({ phoneNumber: phoneNumber.trim() });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'A farmer with this phone number is already registered',
      });
    }

    // Only allow whitelisted fields — farmDetails comes from updateLocation, not registration
    const user = await User.create({
      name: name.trim(),
      phoneNumber: phoneNumber.trim(),
      password,
      preferredLanguage: preferredLanguage || 'en',
    });

    const token = user.getSignedJwtToken();

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        phoneNumber: user.phoneNumber,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        farmDetails: user.farmDetails,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Login farmer
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    if (!phoneNumber || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both phone number and password',
      });
    }

    const user = await User.findOne({ phoneNumber }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password',
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password',
      });
    }

    const token = user.getSignedJwtToken();

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        phoneNumber: user.phoneNumber,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        farmDetails: user.farmDetails,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current and new password',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters',
      });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update user profile (name and photo)
// @route   PUT /api/auth/update-profile
// @access  Private
export const updateProfile = async (req, res) => {
  try {
    const { name, profilePhoto } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    const updateFields = { name: name.trim() };

    // Handle photo: set if provided, clear if empty string
    if (profilePhoto !== undefined) {
      if (profilePhoto === '') {
        updateFields.profilePhoto = ''; // Handles the delete function
      } else if (typeof profilePhoto === 'string' && profilePhoto.startsWith('data:image/')) {
        // Enforce the 500KB size limit (~700,000 base64 chars) 
        if (profilePhoto.length > 700000) {
          return res.status(400).json({ success: false, message: 'Image too large. Max 500KB.' });
        }
        updateFields.profilePhoto = profilePhoto;
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateFields,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        phoneNumber: user.phoneNumber,
        profilePhoto: user.profilePhoto || '',
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
export const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude, fullAddress, addressComponents } = req.body;

    const updateFields = {
      'farmDetails.latitude': latitude,
      'farmDetails.longitude': longitude,
      'farmDetails.fullAddress': fullAddress,
    };

    if (addressComponents) {
      if (addressComponents.village) updateFields['farmDetails.village'] = addressComponents.village;
      if (addressComponents.district) updateFields['farmDetails.district'] = addressComponents.district;
      if (addressComponents.state) updateFields['farmDetails.state'] = addressComponents.state;
      if (addressComponents.country) updateFields['farmDetails.country'] = addressComponents.country;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateFields,
      { new: true }
    );
    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};