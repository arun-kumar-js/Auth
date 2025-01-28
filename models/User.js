const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: String,
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ["seller", "user"],
    default: "user",
  },
  resetPassword: {
    type: String, // This will store the reset token
    default: null,
  },
  resetPasswordExpires: {
    type: Date, // This will store the token's expiration time
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("User", userSchema, "users");
