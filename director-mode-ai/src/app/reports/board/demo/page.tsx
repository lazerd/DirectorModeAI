import BoardReport from "@/components/boardReport/BoardReport";
import { demoBoardReport } from "@/lib/boardReport/demoData";

export const metadata = {
  title: "Monthly Board Report — Sample | ClubMode AI",
};

// Public showcase. No auth — this is what we show prospective clubs and boards.
export default function BoardReportDemoPage() {
  return (
    <div className="min-h-screen bg-gray-100 py-8 print:bg-white print:py-0">
      <BoardReport data={demoBoardReport} />
    </div>
  );
}
