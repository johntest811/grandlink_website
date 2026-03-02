import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Email transporter
let mailTransporter: nodemailer.Transporter | null = null;
if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
  mailTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const { type, data, adminName } = await request.json();
    const productName = data?.productName ?? data?.product_name;
    const productId = data?.productId ?? data?.product_id;
    const newStock = data?.newStock ?? data?.new_stock;

    console.log("📢 Admin notification request:", { type, data, adminName });

    if (type === 'new_product') {
      // Get all users with their notification preferences
      const { data: allUsers, error: usersError } = await supabase.auth.admin.listUsers();
      
      if (usersError) {
        console.error("Error fetching users:", usersError);
        return NextResponse.json({ success: false, error: usersError.message }, { status: 500 });
      }

      let notificationsSent = 0;
      let emailsSent = 0;

      for (const user of allUsers.users) {
        // Check user preferences
        const { data: prefs } = await supabase
          .from('user_notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();

        const shouldNotify = prefs?.new_product_notifications !== false;
        const shouldEmail = prefs?.email_notifications !== false;

        if (shouldNotify) {
          // Create in-app notification
          const { error: notifError } = await supabase
            .from('user_notifications')
            .insert({
              user_id: user.id,
              title: 'New Product Available! 🆕',
              message: `Check out our new product: ${productName}`,
              type: 'new_product',
              metadata: {
                product_id: productId,
                product_name: productName,
                admin_name: adminName
              },
              action_url: `/Product/details?id=${productId}`,
              product_id: productId,
              is_read: false,
              created_at: new Date().toISOString()
            });

          if (!notifError) {
            notificationsSent++;
          }
        }

        if (shouldEmail && mailTransporter && user.email) {
          try {
            await mailTransporter.sendMail({
              from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
              to: user.email,
              subject: 'New Product Available - Grand Link',
              text: `Hello! We're excited to announce that a new product "${productName}" has been added to our catalog. Check it out on our website and place your order today!`,
              html: `<p>Hello!</p><p>We're excited to announce that a new product <strong>"${productName}"</strong> has been added to our catalog.</p><p>Check it out on our website and place your order today!</p>`
            });
            emailsSent++;
          } catch (emailError) {
            console.error("Error sending email to", user.email, emailError);
          }
        }
      }

      console.log(`✅ New product notifications sent: ${notificationsSent} in-app, ${emailsSent} emails`);
      return NextResponse.json({ 
        success: true, 
        message: `Notifications sent to ${notificationsSent} users (${emailsSent} emails)` 
      });

    } else if (type === 'stock_update') {
      // Similar logic for stock updates
      const { data: allUsers, error: usersError } = await supabase.auth.admin.listUsers();
      
      if (usersError) {
        console.error("Error fetching users:", usersError);
        return NextResponse.json({ success: false, error: usersError.message }, { status: 500 });
      }

      let notificationsSent = 0;
      let emailsSent = 0;

      for (const user of allUsers.users) {
        const { data: prefs } = await supabase
          .from('user_notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();

        const shouldNotify = prefs?.stock_update_notifications !== false;
        const shouldEmail = prefs?.email_notifications !== false;

        if (shouldNotify) {
          const { error: notifError } = await supabase
            .from('user_notifications')
            .insert({
              user_id: user.id,
              title: 'Stock Replenished! 📦',
              message: `${productName} is back in stock with ${newStock} units available. Order now!`,
              type: 'stock_update',
              metadata: {
                product_id: productId,
                product_name: productName,
                new_stock: newStock,
                admin_name: adminName
              },
              action_url: `/Product/details?id=${productId}`,
              product_id: productId,
              is_read: false,
              created_at: new Date().toISOString()
            });

          if (!notifError) {
            notificationsSent++;
          }
        }

        if (shouldEmail && mailTransporter && user.email) {
          try {
            await mailTransporter.sendMail({
              from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
              to: user.email,
              subject: 'Stock Replenished - Grand Link',
              text: `Great news! "${productName}" is back in stock with ${newStock} units available. Order now before it's gone!`,
              html: `<p>Great news!</p><p><strong>"${productName}"</strong> is back in stock with <strong>${newStock}</strong> units available.</p><p>Order now before it's gone!</p>`
            });
            emailsSent++;
          } catch (emailError) {
            console.error("Error sending email to", user.email, emailError);
          }
        }
      }

      console.log(`✅ Stock update notifications sent: ${notificationsSent} in-app, ${emailsSent} emails`);
      return NextResponse.json({ 
        success: true, 
        message: `Stock notifications sent to ${notificationsSent} users (${emailsSent} emails)` 
      });
    }

    return NextResponse.json({ success: false, error: "Invalid notification type" }, { status: 400 });

  } catch (error) {
    console.error("💥 Admin notification error:", error);
    return NextResponse.json({ 
      success: false, 
      error: "Internal server error" 
    }, { status: 500 });
  }
}