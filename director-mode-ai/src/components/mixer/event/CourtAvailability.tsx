import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Match {
  id: string;
  court_number: number;
  winner_team: number | null;
}

interface CourtAvailabilityProps {
  totalCourts: number;
  currentRoundMatches: Match[];
}

const CourtAvailability = ({ totalCourts, currentRoundMatches }: CourtAvailabilityProps) => {
  const courtsInUse = currentRoundMatches
    .filter(m => m.winner_team === null)
    .map(m => m.court_number);
  
  const courtsAvailable = Array.from({ length: totalCourts }, (_, i) => i + 1)
    .filter(courtNum => !courtsInUse.includes(courtNum));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Court Availability</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">In Use ({courtsInUse.length})</p>
            <div className="flex flex-wrap gap-2">
              {courtsInUse.length > 0 ? (
                courtsInUse.map(courtNum => (
                  <Badge key={courtNum} variant="destructive">
                    Court {courtNum}
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No courts in use</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Available ({courtsAvailable.length})</p>
            <div className="flex flex-wrap gap-2">
              {courtsAvailable.length > 0 ? (
                courtsAvailable.map(courtNum => (
                  <Badge key={courtNum} variant="secondary">
                    Court {courtNum}
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">All courts in use</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default CourtAvailability;
