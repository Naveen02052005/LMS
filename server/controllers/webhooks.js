import { Webhook } from "svix";
import User from "../models/User.js"
import Stripe from "stripe";
import { Purchase } from "../models/Purchase.js";
import Course from "../models/course.js";
import { request } from "express";


//  API Controller Function to Manage Clerk User with database

export const clerkWebhooks = async (req, res) => {
    try{
        const whook = new Webhook(process.env.CLERK_WEBHOOK_SECRET)

        await whook.verify(JSON.stringify(req.body),{
            "svix-id": req.headers["svix-id"],
            "svix-timestamp": req.headers['svix-timestamp'],
            "svix-signature": req.headers["svix-signature"]
        })

        const {data, type} = req.body

        switch(type) {
            case 'user.created':{
                const userData = {
                    _id: data.id,
                    email: data.email_addresses[0].email_address,
                    name: data.first_name + " " + data.last_name,
                    imageUrl: data.image_url,
                }
                await User.create(userData)
                res.json({})
                break;
            }

            case 'user.updated': {
                const userData = {
                    email: data.email_addresses[0].email_address,
                    name: data.first_name + " " + data.last_name,
                    imageUrl: data.image_url,
                }
                await User.findByIdAndUpdate(data.id,userData)
                res.json({})
                break;
            }

            case 'user.deleted': {
                await User.findByIdAndDelete(data.id);
                res.json({});
                break;
            }

        }
    } catch(error){
        res.json({success: false, message: error.message})
    }
}




// Stripe Webhook Controller
export const stripeWebhooks = async (request, response) => {
  const stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY);

  const sig = request.headers["stripe-signature"];

  let event;

  try {
    event = Stripe.webhooks.constructEvent(
      request.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("❌ Webhook signature verification failed:", err.message);
    return response.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      // =========================
      // PAYMENT SUCCESS
      // =========================
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        const paymentIntentId = paymentIntent.id;

        console.log("✅ Payment succeeded:", paymentIntentId);

        // Get Checkout Session
        const session = await stripeInstance.checkout.sessions.list({
          payment_intent: paymentIntentId,
          limit: 1,
        });

        if (!session.data.length) {
          console.log("❌ No session found for payment intent");
          return response.json({ received: true });
        }

        const purchaseId = session.data[0]?.metadata?.purchaseId;

        if (!purchaseId) {
          console.log("❌ Missing purchaseId in metadata");
          return response.json({ received: true });
        }

        const purchaseData = await Purchase.findById(purchaseId);
        if (!purchaseData) {
          console.log("❌ Purchase not found");
          return response.json({ received: true });
        }

        const userData = await User.findById(purchaseData.userId);
        const courseData = await Course.findById(purchaseData.courseId);

        if (!userData || !courseData) {
          console.log("❌ User or Course not found");
          return response.json({ received: true });
        }

        // Prevent duplicate enrollment
        const alreadyEnrolled = courseData.enrolledStudents.includes(userData._id);

        if (!alreadyEnrolled) {
          courseData.enrolledStudents.push(userData._id);
          await courseData.save();
        }

        const alreadyInUser = userData.enrolledCourses.includes(courseData._id);

        if (!alreadyInUser) {
          userData.enrolledCourses.push(courseData._id);
          await userData.save();
        }

        purchaseData.status = "completed";
        await purchaseData.save();

        console.log("🎉 MongoDB updated successfully for payment");

        break;
      }

      // =========================
      // PAYMENT FAILED
      // =========================
      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;
        const paymentIntentId = paymentIntent.id;

        console.log("❌ Payment failed:", paymentIntentId);

        const session = await stripeInstance.checkout.sessions.list({
          payment_intent: paymentIntentId,
          limit: 1,
        });

        if (!session.data.length) {
          return response.json({ received: true });
        }

        const purchaseId = session.data[0]?.metadata?.purchaseId;

        if (!purchaseId) {
          return response.json({ received: true });
        }

        const purchaseData = await Purchase.findById(purchaseId);

        if (purchaseData) {
          purchaseData.status = "failed";
          await purchaseData.save();
        }

        break;
      }

      // =========================
      default:
        console.log("⚠️ Unhandled event:", event.type);
    }

    return response.json({ received: true });

  } catch (error) {
    console.log("❌ Webhook processing error:", error.message);
    return response.status(500).json({ error: error.message });
  }
};