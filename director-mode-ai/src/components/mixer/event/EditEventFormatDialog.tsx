import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { editEventFormatSchema, type EditEventFormatFormData } from "@/lib/validationSchemas";

interface Event {
  id: string;
  scoring_format: string;
  round_length_minutes: number | null;
  target_games: number | null;
  num_courts: number;
}

interface EditEventFormatDialogProps {
  event: Event;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFormatUpdated: () => void;
}

const EditEventFormatDialog = ({ event, open, onOpenChange, onFormatUpdated }: EditEventFormatDialogProps) => {
  const { toast } = useToast();

  const form = useForm<EditEventFormatFormData>({
    resolver: zodResolver(editEventFormatSchema),
    defaultValues: {
      scoringFormat: event.scoring_format as "timed" | "fixed_games" | "first_to_x" | "pro_set" | "best_of_3_sets" | "best_of_3_tiebreak" | "flexible",
      roundLengthMinutes: event.round_length_minutes || 30,
      targetGames: event.target_games || 11,
      numCourts: event.num_courts,
    },
  });

  const scoringFormat = form.watch("scoringFormat");
  const isTournamentFormat = scoringFormat === "flexible" || scoringFormat === "pro_set" || scoringFormat === "best_of_3_sets" || scoringFormat === "best_of_3_tiebreak";

  useEffect(() => {
    form.reset({
      scoringFormat: event.scoring_format as "timed" | "fixed_games" | "first_to_x" | "pro_set" | "best_of_3_sets" | "best_of_3_tiebreak" | "flexible",
      roundLengthMinutes: event.round_length_minutes || 30,
      targetGames: event.target_games || 11,
      numCourts: event.num_courts,
    });
  }, [event, form]);

  const handleSave = async (data: EditEventFormatFormData) => {
    const updates: any = {
      scoring_format: data.scoringFormat,
      round_length_minutes: data.scoringFormat === "timed" ? data.roundLengthMinutes : null,
      target_games: data.scoringFormat !== "timed" ? data.targetGames : null,
      num_courts: data.numCourts,
    };

    const { error } = await supabase
      .from("events")
      .update(updates)
      .eq("id", event.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error updating format",
        description: error.message,
      });
    } else {
      toast({
        title: "Format updated",
        description: "Event format has been updated successfully.",
      });
      onFormatUpdated();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Event Format</DialogTitle>
          <DialogDescription>Update the scoring format and court configuration for this event</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSave)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="scoringFormat"
              render={({ field }) => (
                 <FormItem>
                  <FormLabel>Scoring Format</FormLabel>
                  <FormControl>
                    <RadioGroup value={field.value} onValueChange={field.onChange}>
                      <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent">
                        <RadioGroupItem value="timed" id="timed" />
                        <FormLabel htmlFor="timed" className="flex-1 cursor-pointer">
                          <div className="font-semibold">Timed Rounds</div>
                          <div className="text-sm text-muted-foreground">Fixed duration per round</div>
                        </FormLabel>
                      </div>
                      <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent">
                        <RadioGroupItem value="first_to_x" id="first_to_x" />
                        <FormLabel htmlFor="first_to_x" className="flex-1 cursor-pointer">
                          <div className="font-semibold">First to X Games</div>
                          <div className="text-sm text-muted-foreground">First team to reach target wins</div>
                        </FormLabel>
                      </div>
                      <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent">
                        <RadioGroupItem value="fixed_games" id="fixed_games" />
                        <FormLabel htmlFor="fixed_games" className="flex-1 cursor-pointer">
                          <div className="font-semibold">Fixed Games</div>
                          <div className="text-sm text-muted-foreground">Play exactly X games per match</div>
                        </FormLabel>
                      </div>
                      <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent">
                        <RadioGroupItem value="flexible" id="flexible" />
                        <FormLabel htmlFor="flexible" className="flex-1 cursor-pointer">
                          <div className="font-semibold">Flexible (any score)</div>
                          <div className="text-sm text-muted-foreground">e.g., 21-19, 11-8</div>
                        </FormLabel>
                      </div>
                      <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent">
                        <RadioGroupItem value="pro_set" id="pro_set" />
                        <FormLabel htmlFor="pro_set" className="flex-1 cursor-pointer">
                          <div className="font-semibold">8 Game Pro-Set</div>
                          <div className="text-sm text-muted-foreground">e.g., 8-3</div>
                        </FormLabel>
                      </div>
                      <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent">
                        <RadioGroupItem value="best_of_3_sets" id="best_of_3_sets" />
                        <FormLabel htmlFor="best_of_3_sets" className="flex-1 cursor-pointer">
                          <div className="font-semibold">Best of 3 Sets</div>
                          <div className="text-sm text-muted-foreground">e.g., 6-3, 2-6, 6-4</div>
                        </FormLabel>
                      </div>
                      <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent">
                        <RadioGroupItem value="best_of_3_tiebreak" id="best_of_3_tiebreak" />
                        <FormLabel htmlFor="best_of_3_tiebreak" className="flex-1 cursor-pointer">
                          <div className="font-semibold">Best of 3 with 10-Point Tiebreak</div>
                          <div className="text-sm text-muted-foreground">e.g., 6-2, 3-7, 10-7</div>
                        </FormLabel>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="numCourts"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Number of Courts</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      max="50"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {scoringFormat === "timed" && (
              <FormField
                control={form.control}
                name="roundLengthMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Round Length (minutes)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="5"
                        max="180"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 30)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {(scoringFormat === "fixed_games" || scoringFormat === "first_to_x") && (
              <FormField
                control={form.control}
                name="targetGames"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {scoringFormat === "first_to_x" ? "Games to Win" : "Total Games"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        max="21"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 11)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default EditEventFormatDialog;
