import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { stageDotClass, stageLabel } from "@shared/dealStages";

interface PipelineStage {
  stage: string;
  count: number;
  value: number;
}

export default function DealPipeline() {
  const { data: pipeline, isLoading } = useQuery<PipelineStage[]>({
    queryKey: ["/api/dashboard/pipeline"],
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStageColor = (stage: string) => {
    return stageDotClass(stage);
  };

  const getStageLabel = (stage: string) => {
    return stageLabel(stage);
  };

  return (
    <Card data-testid="deal-pipeline-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">Deal Pipeline</CardTitle>
        <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80">
          View All
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-16 bg-muted rounded-lg"></div>
              </div>
            ))}
          </div>
        ) : !pipeline?.length ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No pipeline data available</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pipeline.map((stage) => (
              <div
                key={stage.stage}
                className="flex items-center justify-between p-4 bg-muted/50 rounded-lg"
                data-testid={`pipeline-stage-${stage.stage}`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 ${getStageColor(stage.stage)} rounded-full`}></div>
                  <span className="font-medium text-foreground">
                    {getStageLabel(stage.stage)}
                  </span>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">
                    {stage.count} deal{stage.count !== 1 ? 's' : ''}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatCurrency(stage.value)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
