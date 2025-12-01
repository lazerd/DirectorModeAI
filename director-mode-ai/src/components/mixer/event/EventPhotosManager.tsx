import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, X, GripVertical } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface EventPhotosManagerProps {
  eventId: string;
  onPhotosChange?: () => void;
}

interface EventPhoto {
  id: string;
  photo_url: string;
  display_order: number;
  storage_path: string;
}

export function EventPhotosManager({ eventId, onPhotosChange }: EventPhotosManagerProps) {
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchPhotos();
  }, [eventId]);

  const fetchPhotos = async () => {
    const { data } = await supabase
      .from("event_photos")
      .select("id, photo_url, display_order, storage_path")
      .eq("event_id", eventId)
      .order("display_order");

    if (data) {
      setPhotos(data);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    console.log("[PhotoUpload] Starting upload, files:", files.length, "current photos:", photos.length);

    // Check limit
    if (photos.length + files.length > 5) {
      toast({
        variant: "destructive",
        title: "Too many photos",
        description: "You can only upload up to 5 photos per event.",
      });
      return;
    }

    setUploading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error("[PhotoUpload] No user logged in");
        throw new Error("Not authenticated");
      }

      console.log("[PhotoUpload] User ID:", user.id, "Event ID:", eventId);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`[PhotoUpload] Processing file ${i + 1}/${files.length}:`, file.name, "size:", file.size);
        
        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
          toast({
            variant: "destructive",
            title: "File too large",
            description: `${file.name} exceeds 5MB limit.`,
          });
          continue;
        }

        // Compress and resize image
        const compressedFile = await compressImage(file);
        console.log("[PhotoUpload] Image compressed, new size:", compressedFile.size);
        
        // Upload to storage
        const fileExt = file.name.split(".").pop();
        const fileName = `${user.id}/${eventId}/${crypto.randomUUID()}.${fileExt}`;
        const filePath = `${fileName}`;
        console.log("[PhotoUpload] Generated file path:", filePath);

        const { error: uploadError } = await supabase.storage
          .from("event-photos")
          .upload(filePath, compressedFile);

        if (uploadError) {
          console.error("[PhotoUpload] Storage upload error:", uploadError);
          console.error("[PhotoUpload] Error details:", {
            message: uploadError.message,
            name: uploadError.name
          });
          throw uploadError;
        }

        console.log("[PhotoUpload] Storage upload successful");

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from("event-photos")
          .getPublicUrl(filePath);

        console.log("[PhotoUpload] Public URL:", publicUrl);

        // Save to database
        const { error: dbError } = await supabase
          .from("event_photos")
          .insert({
            event_id: eventId,
            photo_url: publicUrl,
            storage_path: filePath,
            display_order: photos.length + i,
            uploaded_by: user.id,
          });

        if (dbError) {
          console.error("[PhotoUpload] Database insert error:", dbError);
          console.error("[PhotoUpload] Error details:", {
            message: dbError.message,
            code: dbError.code,
            details: dbError.details,
            hint: dbError.hint
          });
          throw dbError;
        }

        console.log("[PhotoUpload] Database insert successful");
      }

      toast({
        title: "Photos uploaded!",
        description: "Your event photos have been added.",
      });

      fetchPhotos();
      onPhotosChange?.();
    } catch (error) {
      console.error("[PhotoUpload] Unexpected error:", error);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: "Could not upload photos. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  };

  const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get canvas context"));
          return;
        }

        // Resize to max 1080px width while maintaining aspect ratio
        let width = img.width;
        let height = img.height;
        const maxWidth = 1080;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Could not compress image"));
            }
          },
          "image/jpeg",
          0.85
        );
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  const deletePhoto = async (photoId: string, storagePath: string) => {
    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from("event-photos")
        .remove([storagePath]);

      if (storageError) throw storageError;

      // Delete from database
      const { error: dbError } = await supabase
        .from("event_photos")
        .delete()
        .eq("id", photoId);

      if (dbError) throw dbError;

      toast({
        title: "Photo deleted",
        description: "The photo has been removed.",
      });

      fetchPhotos();
      onPhotosChange?.();
    } catch (error) {
      console.error("Delete error:", error);
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: "Could not delete photo. Please try again.",
      });
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Event Photos</h3>
            <p className="text-sm text-muted-foreground">
              Add up to 5 photos to include in your results card ({photos.length}/5)
            </p>
          </div>
          {photos.length < 5 && (
            <Button
              variant="outline"
              onClick={() => document.getElementById("photo-upload")?.click()}
              disabled={uploading}
            >
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? "Uploading..." : "Add Photos"}
            </Button>
          )}
          <input
            id="photo-upload"
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileUpload}
            disabled={uploading}
          />
        </div>

        {photos.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {photos.map((photo) => (
              <div key={photo.id} className="relative group aspect-square rounded-lg overflow-hidden bg-muted">
                <img
                  src={photo.photo_url}
                  alt="Event photo"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deletePhoto(photo.id, photo.storage_path)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {photos.length === 0 && (
          <div className="text-center py-8 border-2 border-dashed rounded-lg">
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">No photos added yet</p>
            <p className="text-sm text-muted-foreground">
              Add photos to create a beautiful results card to share
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}