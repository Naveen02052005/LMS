import { Webhook } from "svix";
import User from "../models/User.js"
import Stripe from "stripe";
import { Purchase } from "../models/Purchase.js";
import Course from "../models/course.js";


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


export const stripeWebhooks = async (request, response) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const sig = request.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      request.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return response.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        const purchaseId = session.metadata?.purchaseId;

        if (!purchaseId) {
          return response.json({ message: "No purchaseId in metadata" });
        }

        const purchaseData = await Purchase.findById(purchaseId);

        if (!purchaseData) {
          return response.json({ message: "Purchase not found" });
        }

        const userData = await User.findById(purchaseData.userId);
        const courseData = await Course.findById(purchaseData.courseId);

        if (!userData || !courseData) {
          return response.json({ message: "User or Course not found" });
        }

        // Avoid duplicates
        if (!courseData.enrolledStudents.includes(userData._id)) {
          courseData.enrolledStudents.push(userData._id);
          await courseData.save();
        }

        if (!userData.enrolledCourses.includes(courseData._id)) {
          userData.enrolledCourses.push(courseData._id);
          await userData.save();
        }

        purchaseData.status = "completed";
        await purchaseData.save();

        console.log("PAYMENT SUCCESS → DB UPDATED");
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object;

        const purchaseId = session.metadata?.purchaseId;

        if (!purchaseId) {
          return response.json({ message: "No purchaseId in metadata" });
        }

        const purchaseData = await Purchase.findById(purchaseId);

        if (purchaseData) {
          purchaseData.status = "failed";
          await purchaseData.save();
        }

        console.log("PAYMENT FAILED → DB UPDATED");
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return response.json({ received: true });
  } catch (error) {
    console.log("Webhook processing error:", error.message);
    return response.status(500).json({ success: false });
  }
};