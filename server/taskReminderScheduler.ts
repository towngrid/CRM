import { storage } from "./storage";
import { sendEmail } from "./sendgrid";
import { getAppUrl } from "./appConfig";

async function processTaskReminders() {
  try {
    const tasks = await storage.getPendingReminderTasks();
    if (tasks.length === 0) return;

    console.log(`Processing ${tasks.length} task reminder(s)...`);

    for (const task of tasks) {
      const assignedEmail = task.assignedEmail;
      if (!assignedEmail) {
        await storage.updateDealTask(task.id, { reminderSent: "true" });
        continue;
      }

      const contactName = [task.contactFirstName, task.contactLastName].filter(Boolean).join(" ") || "Unknown Contact";
      const repName = [task.assignedUserFirstName, task.assignedUserLastName].filter(Boolean).join(" ") || "Rep";
      const dueDateStr = task.dueDate
        ? new Date(task.dueDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
        : "No due date";
      const dueTimeStr = task.dueTime || "";
      const dealLink = `${getAppUrl()}/deal/${task.dealId}`;

      const typeLabels: Record<string, string> = {
        call: "📞 Call",
        email: "✉️ Email",
        demo: "🎥 Demo",
        follow_up: "🔁 Follow-up",
        site_visit: "🏪 Site Visit",
        other: "📋 Other",
      };
      const typeLabel = typeLabels[task.taskType] || task.taskType;

      const subject = `⚑ Reminder: ${task.title} — ${contactName}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #f59e0b; color: white; padding: 12px 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0; font-size: 18px;">⚑ Task Reminder</h2>
          </div>
          <div style="background: #fff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; padding: 20px;">
            <h3 style="margin: 0 0 16px 0; color: #111827; font-size: 20px;">${task.title}</h3>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">Contact</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;"><strong>${contactName}</strong>${task.contactPhone ? ` · ${task.contactPhone}` : ""}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Task Type</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${typeLabel}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Due</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${dueDateStr}${dueTimeStr ? ` at ${dueTimeStr}` : ""}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Deal</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${task.dealTitle}</td>
              </tr>
              ${task.notes ? `
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px; vertical-align: top;">Notes</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${task.notes}</td>
              </tr>` : ""}
            </table>

            <a href="${dealLink}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">
              Open Deal → ${contactName}
            </a>
          </div>
        </div>
      `;

      try {
        await sendEmail({
          to: assignedEmail,
          subject,
          body: html,
        });
        console.log(`Reminder sent for task "${task.title}" to ${assignedEmail}`);
      } catch (emailErr) {
        console.error(`Failed to send reminder for task ${task.id}:`, emailErr);
      }

      await storage.updateDealTask(task.id, { reminderSent: "true" });
    }
  } catch (error) {
    console.error("Task reminder scheduler error:", error);
  }
}

export function startTaskReminderScheduler() {
  console.log("Starting task reminder scheduler (runs every 15 minutes)");
  processTaskReminders();
  setInterval(processTaskReminders, 15 * 60 * 1000);
}
