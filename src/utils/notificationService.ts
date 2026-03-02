import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

export const notificationService = {
  // Send product added notification
  async notifyProductAdded(productName: string, adminName: string, productId: string) {
    try {
      // Get all users who want product notifications
      const { data: users, error: usersError } = await supabase
        .from('user_notification_preferences')
        .select('*')
        .eq('new_product_notifications', true);
      
      if (usersError) {
        console.error("Error fetching user preferences:", usersError);
        return;
      }

      // Create notifications for all users who want them
      for (const userPref of users) {
        // Create in-app notification
        await supabase
          .from('user_notifications')
          .insert({
            user_id: userPref.user_id,
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

        // Send email if enabled
        if (userPref.email_notifications) {
          const { data: userData } = await supabase.auth.admin.getUserById(userPref.user_id);
          if (userData.user?.email) {
            await this.sendEmailNotification({
              recipientEmail: userData.user.email,
              subject: 'New Product Available - Grand East',
              message: `Hello! We're excited to announce that a new product "${productName}" has been added to our catalog. Check it out on our website and place your order today!`,
              notificationType: 'product_added',
              relatedEntityType: 'product',
              relatedEntityId: productId
            });
          }
        }
      }

      console.log(`Product added notifications sent for: ${productName}`);
    } catch (error) {
      console.error("Error sending product added notifications:", error);
    }
  },

  // Send stock update notification
  async notifyStockUpdate(productName: string, newStock: number, adminName: string, productId: string) {
    try {
      // Only notify if stock increased (restocked)
      const { data: users, error: usersError } = await supabase
        .from('user_notification_preferences')
        .select('*')
        .eq('stock_update_notifications', true);
      
      if (usersError) {
        console.error("Error fetching user preferences:", usersError);
        return;
      }

      for (const userPref of users) {
        // Create in-app notification
        await supabase
          .from('user_notifications')
          .insert({
            user_id: userPref.user_id,
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

        // Send email if enabled
        if (userPref.email_notifications) {
          const { data: userData } = await supabase.auth.admin.getUserById(userPref.user_id);
          if (userData.user?.email) {
            await this.sendEmailNotification({
              recipientEmail: userData.user.email,
              subject: 'Stock Replenished - Grand East',
              message: `Great news! "${productName}" is back in stock with ${newStock} units available. Order now before it's gone!`,
              notificationType: 'stock_updated',
              relatedEntityType: 'product',
              relatedEntityId: productId
            });
          }
        }
      }

      console.log(`Stock update notifications sent for: ${productName}`);
    } catch (error) {
      console.error("Error sending stock update notifications:", error);
    }
  },

  // Send order status update notification
  async notifyOrderStatusUpdate(userId: string, productName: string, newStatus: string, orderDetails: any) {
    try {
      // Check if user wants order notifications
      const { data: userPref } = await supabase
        .from('user_notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (userPref && userPref.order_status_notifications === false) return;

      // Get user email
      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      if (!userData.user?.email) return;

      const statusMessages = {
        'pending_payment': 'Your order is awaiting payment confirmation.',
        'reserved': 'Your order has been reserved and payment confirmed.',
        'pending_balance_payment': 'Please settle the remaining balance to keep your order moving forward.',
        'approved': 'Your order has been approved and will begin production soon.',
        'in_production': 'Your order is currently being manufactured.',
        'ready_for_delivery': 'Your order is ready for delivery! We will contact you soon.',
        'completed': 'Your order has been completed successfully. Thank you for choosing Grand East!',
        'cancelled': 'Your order has been cancelled. If you have any questions, please contact us.',
        'pending_cancellation': 'Your cancellation request is being processed.'
      };

      const message = statusMessages[newStatus as keyof typeof statusMessages] || `Your order status has been updated to: ${newStatus}`;

      // Create in-app notification
      await supabase
        .from('user_notifications')
        .insert({
          user_id: userId,
          title: `Order Status: ${newStatus.replace('_', ' ').toUpperCase()}`,
          message: `${productName} - ${message}`,
          type: 'order_status',
          metadata: {
            order_id: orderDetails.id,
            product_name: productName,
            new_status: newStatus,
            product_id: orderDetails.product_id
          },
          action_url: `/profile/order?id=${orderDetails.id}`,
          order_id: orderDetails.id,
          is_read: false,
          created_at: new Date().toISOString()
        });

      // Send email if enabled
      if (userPref.email_notifications) {
        await this.sendEmailNotification({
          recipientEmail: userData.user.email,
          subject: `Order Status Update - ${productName}`,
          message: `Dear Customer,

${message}

Order Details:
Product: ${productName}
Status: ${newStatus.replace('_', ' ').toUpperCase()}
Order ID: ${orderDetails.id}

You can track your order status by logging into your account on our website.

Thank you for choosing Grand East!

Best regards,
Grand East Team`,
          notificationType: 'order_status',
          relatedEntityType: 'user_item',
          relatedEntityId: orderDetails.id
        });
      }

      console.log(`Order status notification sent to: ${userData.user.email}`);
    } catch (error) {
      console.error("Error sending order status notification:", error);
    }
  },

  // Helper method to send email notifications
  async sendEmailNotification({
    recipientEmail,
    subject,
    message,
    notificationType,
    relatedEntityType,
    relatedEntityId
  }: {
    recipientEmail: string;
    subject: string;
    message: string;
    notificationType: string;
    relatedEntityType: string;
    relatedEntityId: string;
  }) {
    try {
      const response = await fetch('/api/send-notification-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipientEmail,
          subject,
          message,
          notificationType,
          relatedEntityType,
          relatedEntityId
        })
      });

      if (!response.ok) {
        throw new Error(`Email API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error sending email notification:", error);
      throw error;
    }
  },

  // Initialize user notification preferences
  async initializeUserPreferences(userId: string) {
    try {
      const { data, error } = await supabase
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

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error initializing user preferences:", error);
      return null;
    }
  },

  // Update user notification preferences
  async updateUserPreferences(userId: string, preferences: {
    new_product_notifications?: boolean;
    stock_update_notifications?: boolean;
    order_status_notifications?: boolean;
    email_notifications?: boolean;
  }) {
    try {
      const { data, error } = await supabase
        .from('user_notification_preferences')
        .upsert({
          user_id: userId,
          ...preferences,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error updating user preferences:", error);
      throw error;
    }
  }
};