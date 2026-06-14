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
export const stripeWebhooks = async(request,response) => {
  const stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY)
  const sig = request.headers['stripe-signature'];

  let event;

  try{
    event = Stripe.webhooks.constructEvent(request.body,sig,process.env.STRIPE_WEBHOOK_SECRET);
  }
  catch(err){
    response.status(400).send(`Webhook Error: ${err.message}`)
  }


  console.log("Webhook received:", event.type);
  switch (event.type) {
    case 'payment_intent.succeeded': {
  try {

    console.log("SUCCESS EVENT STARTED");

    const paymentIntent = event.data.object;
    const paymentIntentId = paymentIntent.id;
    console.log("Payment Intent:", paymentIntentId);

    const session = await stripeInstance.checkout.sessions.list({
      payment_intent: paymentIntentId
    });

    console.log("Session Found:", session.data.length);

    const { purchaseId } = session.data[0].metadata;
    console.log("Purchase ID:", purchaseId);

    const purchaseData = await Purchase.findById(purchaseId);
    console.log("Purchase Found:", !!purchaseData);

    const userData = await User.findById(purchaseData.userId);
    console.log("User Found:", !!userData);

    const courseData = await Course.findById(purchaseData.courseId);
    console.log("Course Found:", !!courseData);

    courseData.enrolledStudents.push(userData._id);
    try {
  await courseData.save();
  console.log("Course saved");
} catch (err) {
  console.log("COURSE SAVE ERROR:", err);
}

    userData.enrolledCourses.push(courseData._id);
    await userData.save();
    console.log("User Saved");

    purchaseData.status = 'completed';
    await purchaseData.save();
    console.log("Purchase Saved");

  } catch(error) {
    console.error("WEBHOOK ERROR:", error);
  }

  break;
}
    case 'payment_intent.payment_failed':{
      try{
      const paymentIntent = event.data.object;
      const paymentIntentId = paymentIntent.id;

      const session = await stripeInstance.checkout.sessions.list({
        payment_intent: paymentIntentId
      })

      const { purchaseId } = session.data[0].metadata;
      const purchaseData = await Purchase.findById(purchaseId)
      purchaseData.status = 'failed';
      await purchaseData.save()}
      catch(error){
        console.error("SUCCESS CASE ERROR",error)
      }
      break;}
    // ... handle other event types
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a response to acknowledge receipt of the event
  response.json({received: true});
}