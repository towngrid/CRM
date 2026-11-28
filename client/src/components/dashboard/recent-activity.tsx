import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserPlus, Handshake, Phone, CheckCircle, Mail, Activity as ActivityIcon } from "lucide-react";
import type { Activity } from "@shared/schema";

export default function RecentActivity() {
  const { data: activities, isLoading } = useQuery<Activity[]>({
    queryKey: ["/api/activities"],
    queryFn: async () => {
      const response = await fetch("/api/activities?limit=5");
      return response.json();
    },
  });

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "contact_added":
        return UserPlus;
      case "deal_created":
      case "deal_stage_changed":
        return Handshake;
      case "task_completed":
        return CheckCircle;
      case "task_created":
        return CheckCircle;
      case "email_sent":
        return Mail;
      case "call_scheduled":
        return Phone;
      default:
        return ActivityIcon;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case "contact_added":
        return "bg-primary/10 text-primary";
      case "deal_created":
      case "deal_stage_changed":
        return "bg-accent/10 text-accent";
      case "task_completed":
        return "bg-green-500/10 text-green-600";
      case "task_created":
        return "bg-yellow-500/10 text-yellow-600";
      case "email_sent":
        return "bg-primary/10 text-primary";
      case "call_scheduled":
        return "bg-yellow-500/10 text-yellow-600";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getTimeAgo = (date: string | Date | null) => {
    if (!date) return "Unknown time";
    const now = new Date();
    const past = new Date(date);
    const diffInHours = Math.floor((now.getTime() - past.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return "Just now";
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
    
    const diffInMonths = Math.floor(diffInDays / 30);
    return `${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`;
  };

  return (
    <Card data-testid="recent-activity-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse flex items-start space-x-3">
                <div className="w-8 h-8 bg-muted rounded-full"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4"></div>
                  <div className="h-3 bg-muted rounded w-1/4"></div>
                </div>
              </div>
            ))}
          </div>
        ) : !activities?.length ? (
          <div className="text-center py-8 text-muted-foreground">
            <ActivityIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No recent activity</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activities.map((activity) => {
              const Icon = getActivityIcon(activity.type);
              const colorClass = getActivityColor(activity.type);
              
              return (
                <div
                  key={activity.id}
                  className="flex items-start space-x-3 p-3 hover:bg-muted/30 rounded-lg transition-colors"
                  data-testid={`activity-${activity.id}`}
                >
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${colorClass}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">
                      {(activity as Activity & { text?: string }).text ?? activity.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getTimeAgo(activity.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
