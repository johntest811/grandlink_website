import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// Server-side Supabase client with service role key
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Setup email transporter
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

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://grandlnik-website.vercel.app';

export const serverNotificationService = {
  // Send new product notification to all users who want them
  async notifyNewProduct(productName: string, productId: string, adminName: string) {
    try {
      console.log("📦 Sending new product notifications...");
      
      // Get all users who want new product notifications
      const { data: preferences, error: prefError } = await supabaseAdmin
        .from('user_notification_preferences')
        .select('user_id, email_notifications, new_product_notifications')
        .eq('new_product_notifications', true);
      
      if (prefError) {
        console.error("Error fetching user preferences:", prefError);
        // If no preferences, notify all users
        const { data: allUsers, error: userError } = await supabaseAdmin.auth.admin.listUsers();
        if (!userError && allUsers.users.length > 0) {
          await this.createNotificationsForAllUsers(allUsers.users, 'new_product', productName, productId, adminName);
        }
        return { success: true, message: "Notifications sent to all users" };
      }

      if (!preferences || preferences.length === 0) {
        console.log("No users want new product notifications");
        return { success: true, message: "No users subscribed" };
      }

      // Create in-app notifications
      const notifications = preferences.map(pref => ({
        user_id: pref.user_id,
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
      }));

      const { error: insertError } = await supabaseAdmin
        .from('user_notifications')
        .insert(notifications);

      if (insertError) {
        console.error("Error inserting notifications:", insertError);
        return { success: false, error: insertError };
      }

      // Send emails to users who want them
      for (const pref of preferences) {
        if (pref.email_notifications && mailTransporter) {
          try {
            const { data: userData } = await supabaseAdmin.auth.admin.getUserById(pref.user_id);
            if (userData.user?.email) {
              await mailTransporter.sendMail({
                from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
                to: userData.user.email,
                subject: `New Product Available - ${productName}`,
                html: `
                  <h2>New Product Alert! 🆕</h2>
                  <p>We're excited to announce a new product:</p>
                  <h3>${productName}</h3>
                  <p>Visit our website to check it out and place your order today!</p>
                  <a href="${process.env.NEXT_PUBLIC_BASE_URL}/Product/details?id=${productId}" style="background-color: #8B1C1C; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">View Product</a>
                  <p style="margin-top: 20px; color: #666; font-size: 12px;">You can manage your notification preferences in your account settings.</p>
                `
              });
            }
          } catch (emailError) {
            console.error("Error sending email:", emailError);
          }
        }
      }

      console.log(`✅ New product notifications sent to ${preferences.length} users`);
      return { success: true, message: `Notifications sent to ${preferences.length} users` };
    } catch (error) {
      console.error("Error sending new product notifications:", error);
      return { success: false, error };
    }
  },

  // Send stock update notification
  async notifyStockUpdate(productName: string, productId: string, newStock: number, adminName: string) {
    try {
      console.log("📈 Sending stock update notifications...");
      
      const { data: preferences, error: prefError } = await supabaseAdmin
        .from('user_notification_preferences')
        .select('user_id, email_notifications, stock_update_notifications')
        .eq('stock_update_notifications', true);
      
      if (prefError) {
        console.error("Error fetching user preferences:", prefError);
        return { success: false, error: prefError };
      }

      if (!preferences || preferences.length === 0) {
        console.log("No users want stock update notifications");
        return { success: true, message: "No users subscribed to stock updates" };
      }

      const notifications = preferences.map(pref => ({
        user_id: pref.user_id,
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
      }));

      const { error: insertError } = await supabaseAdmin
        .from('user_notifications')
        .insert(notifications);

      if (insertError) {
        console.error("Error inserting stock notifications:", insertError);
        return { success: false, error: insertError };
      }

      // Send emails
      for (const pref of preferences) {
        if (pref.email_notifications && mailTransporter) {
          try {
            const { data: userData } = await supabaseAdmin.auth.admin.getUserById(pref.user_id);
            if (userData.user?.email) {
              await mailTransporter.sendMail({
                from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
                to: userData.user.email,
                subject: `Stock Alert - ${productName}`,
                html: `
                  <h2>Stock Replenished! 📦</h2>
                  <p><strong>${productName}</strong> is back in stock!</p>
                  <p>We now have <strong>${newStock}</strong> units available.</p>
                  <p>Order now before it's gone again!</p>
                  <a href="${process.env.NEXT_PUBLIC_BASE_URL}/Product/details?id=${productId}" style="background-color: #8B1C1C; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">Order Now</a>
                  <p style="margin-top: 20px; color: #666; font-size: 12px;">You can manage your notification preferences in your account settings.</p>
                `
              });
            }
          } catch (emailError) {
            console.error("Error sending email:", emailError);
          }
        }
      }

      console.log(`✅ Stock update notifications sent to ${preferences.length} users`);
      return { success: true, message: `Stock notifications sent to ${preferences.length} users` };
    } catch (error) {
      console.error("Error sending stock update notifications:", error);
      return { success: false, error };
    }
  },

  // Send order status update notification
  async notifyOrderStatusUpdate(userId: string, orderDetails: any, newStatus: string, adminName: string) {
    try {
      console.log("📋 Sending order status notification...");
      
      // Check if user wants order notifications
      const { data: pref, error: prefError } = await supabaseAdmin
        .from('user_notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (prefError && prefError.code !== 'PGRST116') {
        console.log("No preferences found, creating default");
        await this.initializeUserPreferences(userId);
      }

      if (pref && !pref.order_status_notifications) {
        console.log("User doesn't want order status notifications");
        return { success: true, message: "User has disabled order notifications" };
      }

      const statusMessages: Record<string, string> = {
        'pending_payment': 'Your order is awaiting payment confirmation.',
        'reserved': 'Your order has been reserved and payment confirmed.',
        'pending_balance_payment': 'Please settle the remaining balance to keep your order moving forward.',
        'approved': 'Your order has been approved and will begin production soon.',
        'in_production': 'Your order is currently being manufactured.',
        'quality_check': 'Your order is undergoing quality inspection.',
        'start_packaging': 'Your order is being packaged for delivery.', // NEW
        'packaging': 'Your order is being packaged for delivery.',
        'ready_for_delivery': 'Your order is ready for delivery! We will contact you soon.',
        'out_for_delivery': 'Your order is on its way to you!',
        'completed': 'Your order has been completed successfully. Thank you for choosing Grand Link!',
        'cancelled': 'Your order has been cancelled. If you have any questions, please contact us.',
        'pending_cancellation': 'Your cancellation request is being processed.'
      };

      const message = statusMessages[newStatus] || `Your order status has been updated to: ${newStatus}`;
      const productName = orderDetails.product_name || 'Your Order';
      const statusDisplay = newStatus.replace(/_/g, ' ').toUpperCase();

      // Create in-app notification
      const { error: insertError } = await supabaseAdmin
        .from('user_notifications')
        .insert({
          user_id: userId,
          title: `Order Status: ${statusDisplay} 📋`,
          message: `${productName} - ${message}`,
          type: 'order_status',
          metadata: {
            order_id: orderDetails.id,
            product_name: productName,
            new_status: newStatus,
            product_id: orderDetails.product_id,
            admin_name: adminName
          },
          action_url: `/profile/order?id=${orderDetails.id}`,
          order_id: orderDetails.id,
          is_read: false,
          created_at: new Date().toISOString()
        });

      if (insertError) {
        console.error("Error inserting order notification:", insertError);
        return { success: false, error: insertError };
      }

      // Send email if enabled
      if ((pref?.email_notifications !== false) && mailTransporter) {
        try {
          const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
          if (userData.user?.email) {
            await mailTransporter.sendMail({
              from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
              to: userData.user.email,
              subject: `Order Update - ${statusDisplay}`,
              html: `
                <h2>Order Status Update 📋</h2>
                <p><strong>Product:</strong> ${productName}</p>
                <p><strong>Status:</strong> ${statusDisplay}</p>
                <p>${message}</p>
                <a href="${process.env.NEXT_PUBLIC_BASE_URL}/profile/order?id=${orderDetails.id}" style="background-color: #8B1C1C; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">View Order Details</a>
                <p style="margin-top: 20px; color: #666; font-size: 12px;">You can manage your notification preferences in your account settings.</p>
              `
            });
          }
        } catch (emailError) {
          console.error("Error sending email:", emailError);
        }
      }

      console.log("✅ Order status notification sent");
      return { success: true, message: "Order status notification sent successfully" };
    } catch (error) {
      console.error("Error sending order status notification:", error);
      return { success: false, error };
    }
  },

  // Helper to create notifications for all users
  async createNotificationsForAllUsers(users: any[], type: string, productName: string, productId: string, adminName: string) {
    try {
      const notifications = users.map(user => ({
        user_id: user.id,
        title: type === 'new_product' ? 'New Product Available! 🆕' : 'Stock Replenished! 📦',
        message: type === 'new_product' 
          ? `Check out our new product: ${productName}`
          : `${productName} is back in stock. Order now!`,
        type,
        metadata: {
          product_id: productId,
          product_name: productName,
          admin_name: adminName
        },
        action_url: `/Product/details?id=${productId}`,
        product_id: productId,
        is_read: false,
        created_at: new Date().toISOString()
      }));

      const { error: insertError } = await supabaseAdmin
        .from('user_notifications')
        .insert(notifications);

      if (insertError) {
        console.error("Error inserting notifications for all users:", insertError);
      } else {
        console.log(`✅ Created notifications for ${users.length} users`);
      }
    } catch (error) {
      console.error("Error creating notifications for all users:", error);
    }
  },

  // Initialize user notification preferences
  async initializeUserPreferences(userId: string) {
    try {
      const { data, error } = await supabaseAdmin
        .from('user_notification_preferences')
        .upsert({
          user_id: userId,
          new_product_notifications: true,
          stock_update_notifications: true,
          order_status_notifications: true,
          email_notifications: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (error) {
        console.error("Error initializing user preferences:", error);
      }
      return data;
    } catch (error) {
      console.error("Error initializing user preferences:", error);
      return null;
    }
  },

  async sendEmailNotification({ recipientEmail, subject, message, notificationType, relatedEntityType, relatedEntityId }: {
    recipientEmail: string; subject: string; message: string;
    notificationType: string; relatedEntityType: string; relatedEntityId: string;
  }) {
    try {
      const response = await fetch(`${BASE_URL}/api/send-notification-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientEmail, subject, message,
          notificationType, relatedEntityType, relatedEntityId
        })
      });
      if (!response.ok) throw new Error(`Email API error: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("Error sending email notification:", error);
      throw error;
    }
  },
};