// src/components/dashboard/reports/ReportCard.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReportCardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: 'increase' | 'decrease';
}

export default function ReportCard({ title, value, change, changeType }: ReportCardProps) {
  const isIncrease = changeType === 'increase';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {change && (
          <p className={cn(
            "text-sm text-muted-foreground flex items-center mt-2",
            isIncrease ? "text-destructive" : "text-green-500"
          )}>
            {isIncrease ? <ArrowUp className="h-4 w-4 mr-1" /> : <ArrowDown className="h-4 w-4 mr-1" />}
            {change} from last week
          </p>
        )}
      </CardContent>
    </Card>
  );
}

    