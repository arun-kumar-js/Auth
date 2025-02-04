const bcrypt = require("bcrypt"); // Password encryption and decryption
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Product = require("../models/seller"); // Assuming you have a Product model
const nodemailer = require("nodemailer");
const cart = require("../models/cart");
const Auth = require("../Middlewares/auth");
const Razorpay = require("razorpay");
const CreateOrder = require("../models/createorder"); // Adjust path if needed
const crypto = require("crypto");
const review = require("../models/review");
const auth = require("../Middlewares/auth");


const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const {
  SECRET_KEY,
  GMAIL_PASSWORD,
  GMAIL_USER,
  MONGODB_URI,
  PORT,
} = require("../utils/config");
const mongoose = require("mongoose");

const authcontroller = {
  // Register a new user
  register: async (request, response) => {
    try {
      const { name, email, password } = request.body;

      const user = await User.findOne({ email }); // Check if user exists
      if (user) {
        return response.status(400).json({ message: "User already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10); // Encrypt password
      const newUser = new User({ name, email, password: hashedPassword });
      await newUser.save();

      response.status(201).json({ message: "User created successfully" });
    } catch (error) {
      response.status(500).json({ message: error.message });
    }
  },
  // Login user
  login: async (request, response) => {
    try {
      const { email, password } = request.body;

      const user = await User.findOne({ email });
      if (!user) {
        return response.status(400).json({ message: "User does not exist" });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return response.status(400).json({ message: "Invalid password" });
      }

      // Create a token
      const token = jwt.sign({ id: user._id }, process.env.SECRET_KEY, {
        expiresIn: "1h",
      });

      // Send token to HTTP cookies
      response.cookie("token", token, {
        httpOnly: true,
        sameSite: "Strict",
        secure: false,
      });
      response.status(200).json({ message: "User logged in successfully" });
    } catch (error) {
      response.status(500).json({ message: error.message });
    }
  },

  // Logout user
  logout: async (request, response) => {
    try {
      response.clearCookie("token");
      response.status(200).json({ message: "User logged out successfully" });
    } catch (error) {
      response.status(500).json({ message: error.message });
    }
  },
  // Get user profile
  me: async (request, response) => {
    try {
      const userId = request.userId;

      const user = await User.findById(userId).select("-password -__v");
      if (!user) {
        return response.status(404).json({ message: "User not found" });
      }

      response.status(200).json({ user });
    } catch (error) {
      response.status(500).json({ message: error.message });
    }
  },
  // geting all the products
  getProducts: async (req, res) => {
    try {
      const { page = 1, limit = 10 } = req.query;

      const products = await Product.find()
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const totalProducts = await Product.countDocuments();

      res.status(200).json({
        products,
        totalPages: Math.ceil(totalProducts / limit),
        currentPage: page,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  /// Reset password
  resetPassword: async (request, response) => {
    try {
      const { email } = request.body;

      const user = await User.findOne({ email });

      if (!user) {
        return response
          .status(404)
          .json({ message: "No account found with this email" });
      }

      const crypto = require("crypto");
      const token = crypto.randomBytes(20).toString("hex");

      user.resetPassword = token;
      user.resetPasswordExpires = Date.now() + 3600000; // Token valid for 1 hour
      await user.save();

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_PASSWORD,
        },
      });

      const message = {
        from: process.env.GMAIL_USER,
        to: user.email,
        subject: "Password Reset",
        text: `Reset your password using the following token: ${token}`,
      };

      transporter.sendMail(message, (err) => {
        if (err) {
          return response
            .status(500)
            .json({ message: "Failed to send reset email", error: err });
        }
        response.status(200).json({ message: "Password reset email sent" });
      });
    } catch (error) {
      response.status(500).json({ message: error.message });
    }
  },

  // Update password
  updatePassword: async (request, response) => {
    try {
      const { code, password } = request.body;

      // Query the user
      const user = await User.findOne({
        resetPassword: code, // Ensure token matches
        resetPasswordExpires: { $gt: Date.now() }, // Ensure token is not expired
      });

      if (!user) {
        return response
          .status(404)
          .json({ message: "Invalid or expired reset code" });
      }

      // Update the user's password
      const hashPassword = await bcrypt.hash(password, 10);
      user.password = hashPassword;
      user.resetPassword = null;
      user.resetPasswordExpires = null;
      await user.save();

      response
        .status(200)
        .json({ message: "Password has been successfully reset" });
    } catch (error) {
      console.error("Error during password reset:", error.message);
      response.status(500).json({ message: "Internal server error" });
    }
  },

  //get product by id
  ProductById: async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (product) {
        res.json(product);
      } else {
        res.status(404).json({ error: "Product not found" });
      }
    } catch (err) {
      res.status(500).json({ error: "Error fetching product details" });
    }
  },

  addToCart: async (req, res) => {
    try {
      const decodedToken = jwt.verify(
        req.cookies.token,
        process.env.SECRET_KEY
      );
      req.user = { id: decodedToken.id };

      const { productId } = req.body;

      if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
      }

      // Check ii have f the product exists
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const userCart = await cart.findOneAndUpdate(
        { userId: req.user.id },
        { $addToSet: { products: productId } },
        { new: true, upsert: true }
      );

      return res
        .status(200)
        .json({ message: "Product added to cart", cart: userCart });
    } catch (error) {
      console.error("Error adding to cart:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
  getCart: async (req, res) => {
    try {
      const decodedToken = jwt.verify(
        req.cookies.token,
        process.env.SECRET_KEY
      );
      req.user = { id: decodedToken.id };

      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const userCart = await cart
        .findOne({ userId: req.user.id })
        .populate("products");

      return res.status(200).json({ cart: userCart });
    } catch (error) {
      console.error("Error fetching cart:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
  removeFromCart: async (req, res) => {
    try {
      const decodedToken = jwt.verify(
        req.cookies.token,
        process.env.SECRET_KEY
      );
      req.user = { id: decodedToken.id };

      const { productId } = req.body;

      if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
      }

      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const userCart = await cart.findOneAndUpdate(
        { userId: req.user.id },
        { $pull: { products: productId } },
        { new: true }
      );

      return res
        .status(200)
        .json({ message: "Product removed from cart", cart: userCart });
    } catch (error) {
      console.error("Error removing from cart:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
  clearCart: async (req, res) => {
    try {
      const decodedToken = jwt.verify(
        req.cookies.token,
        process.env.SECRET_KEY
      );
      req.user = { id: decodedToken.id };

      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const userCart = await cart.findOneAndDelete({ userId: req.user.id });

      return res.status(200).json({ message: "Cart cleared", cart: userCart });
    } catch (error) {
      console.error("Error clearing cart:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
  // Get all orders
  getOrders: async (req, res) => {
    try {
      const decodedToken = jwt.verify(
        req.cookies.token,
        process.env.SECRET_KEY
      );
      req.user = { id: decodedToken.id };

      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // ✅ Populate the products array with full product details
      const userOrder = await Order.findOne({ userId: req.user.id }).populate(
        "products"
      ); // Ensure this is the correct reference in your schema

      if (!userOrder) {
        return res.status(404).json({ message: "No orders found" });
      }

      return res.status(200).json({ order: userOrder });
    } catch (error) {
      console.error("Error fetching order:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
  getAllOrders: async (req, res) => {
    try {
      // Decode the token to get the user ID
      const decodedToken = jwt.verify(
        req.cookies.token,
        process.env.SECRET_KEY
      );
      req.user = { id: decodedToken.id };

      // Check if the user is authenticated
      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Fetch all orders for the user and populate the 'products' field
      const getAllOrders = await Order.find({ userId: req.user.id }).populate(
        "cartItems.productId"
      );

      // If no orders found for the user, return a 404 error
      if (getAllOrders.length === 0) {
        return res.status(404).json({ message: "No orders found" });
      }

      // Send the retrieved orders as a response
      return res.status(200).json({ orders: getAllOrders });
    } catch (error) {
      console.error("Error fetching orders:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
  razorpayOrder: async (req, res) => {
    try {
      const { amount } = req.body;

      // Validate the amount
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      console.log("Received amount:", amount); // Log the amount

      const options = {
        amount: amount * 100, // Convert to paise
        currency: "INR",
        receipt: `order_rcpt_${Date.now()}_${Math.floor(
          Math.random() * 1000000
        )}`, // Unique receipt with timestamp
      };

      const order = await razorpay.orders.create(options);
      res.json({ orderId: order.id });
    } catch (error) {
      console.error("Error creating Razorpay order:", error);
      res.status(500).json({
        error: error.message || "Razorpay order creation failed",
        details: error.stack, // Add stack trace for better debugging
      });
    }
  },
  createOrder : async (req, res) => {
  const { userId, name, address, phoneNumber, products, totalPrice, paymentId } = req.body;
   console.log(
     userId,
     name,
     address,
     phoneNumber,
     products,
     totalPrice,
     paymentId
   );
  if (!userId || !totalPrice ) {
    return res.status(400).json({
      error: 'User ID, total price, and payment ID are required',
    });
  }

  try {
    const newOrder = new CreateOrder({
      userId,
      name,
      address,
      phoneNumber,
      products,
      totalPrice,
      paymentId,
    });

    await newOrder.save();
    res.status(201).json({ success: true, message: 'Order created successfully', order: newOrder });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(400).json({ success: false, message: 'Failed to store order' });
  }
},
  verifyPayment: async (req, res) => {
    console.log("Cookies received:", req.cookies);
    try {
      const decodedToken = jwt.verify(
        req.cookies.token,
        process.env.SECRET_KEY
      );
      req.user = { id: decodedToken.id };
      console.log(req.user);

      // 2. Razorpay signature verification
      const { razorpay_payment_id, razorpay_order_id, razorpay_signature } =
        req.body;
      console.log(razorpay_payment_id, razorpay_order_id, razorpay_signature);
      const generatedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (generatedSignature === razorpay_signature) {
        // Payment is successful
        res.status(200).json({ message: "Payment verified successfully" });
      } else {
        res.status(400).json({ message: "Invalid payment signature" });
      }
    } catch (error) {
      console.error("Error verifying payment:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },
  addReview: async (req, res) => {
    try {
      const decodedToken = jwt.verify(
        req.cookies.token,
        process.env.SECRET_KEY
      );
      console.log(decodedToken);
      req.user = { id: decodedToken.id };
      console.log(req.user);
      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const { productId, rating, review } = req.body;
      if (!productId || !rating || !review) {
        return res
          .status(400)
          .json({ message: "Product ID, rating, and review are required" });
      }

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const newReview = { userId: req.user.id, rating, review };
      product.reviews.push(newReview);
      await product.save();

      return res.status(200).json({ message: "Review added successfully" });
    } catch (error) {
      console.error("Error adding review:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
};






module.exports = authcontroller;  // Export authController
