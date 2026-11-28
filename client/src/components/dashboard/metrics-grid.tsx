import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Handshake, DollarSign, CheckCircle } from "lucide-react";
import { monthLine, type DashboardMetrics } from "@shared/dashboardMetrics";

export default function MetricsGrid() {
  const { data: metrics, isLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const empty = { thisMonth: 0, lastMonth: 0 };
  // Each card: a real number, and a real "this month · last month" line underneath.
  const metricCards = [
    {
      title: "Total Contacts",
      value: metrics?.totalContacts ?? 0,
      icon: Users,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      line: `Added from Business Search: ${monthLine(metrics?.contactsAdded ?? empty).toLowerCase()}`,
    },
    {
      title: "Active Deals",
      value: metrics?.activeDeals ?? 0,
      icon: Handshake,
      iconBg: "bg-accent/10",
      iconColor: "text-accent",
      line: `New deals: ${monthLine(metrics?.newDeals ?? empty).toLowerCase()}`,
    },
    {
      title: "Won This Month",
      value: formatCurrency(metrics?.wonRevenue.thisMonth ?? 0),
      icon: DollarSign,
      iconBg: "bg-accent/10",
      iconColor: "text-accent",
      line: (metrics?.wonDeals.thisMonth || metrics?.wonDeals.lastMonth)
        ? `${metrics!.wonDeals.thisMonth} deal${metrics!.wonDeals.thisMonth === 1 ? "" : "s"} won · last month ${formatCurrency(metrics!.wonRevenue.lastMonth)}`
        : "No deals won yet",
    },
    {
      title: "Tasks Completed",
      value: metrics?.tasksCompleted ?? 0,
      icon: CheckCircle,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      line: monthLine(metrics?.tasksCompletedByMonth ?? empty),
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded w-24"></div>
                  <div className="h-8 bg-muted rounded w-16"></div>
                </div>
                <div className="w-12 h-12 bg-muted rounded-full"></div>
              </div>
              <div className="mt-4 flex items-center">
                <div className="h-4 bg-muted rounded w-20"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8" data-testid="metrics-grid">
      {metricCards.map((metric, index) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.title} data-testid={`metric-card-${index}`}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {metric.title}
                  </p>
                  <p className="text-3xl font-bold text-foreground" data-testid={`metric-value-${index}`}>
                    {metric.value}
                  </p>
                </div>
                <div className={`p-3 ${metric.iconBg} rounded-full`}>
                  <Icon className={`${metric.iconColor} h-6 w-6`} />
                </div>
              </div>
              <p className="mt-4 text-sm text-muted-foreground" data-testid={`metric-line-${index}`}>{metric.line}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
