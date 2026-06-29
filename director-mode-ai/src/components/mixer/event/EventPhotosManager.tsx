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
  const [isDragging, setIsDragging] = useState(false);

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

  const uploadFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;

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
      for (const file of files) {
        if (file.size > 15 * 1024 * 1024) {
          toast({ variant: "destructive", title: "File too large", description: `${file.name} is too large.` });
          continue;
        }

        // Compress/resize client-side, then upload via the service-role route
        // (bypasses storage RLS — direct client uploads were being rejected).
        const compressed = await compressImage(file);
        const fd = new FormData();
        fd.append("file", new File([compressed], "photo.jpg", { type: "image/jpeg" }));

        const res = await fetch(`/api/events/${eventId}/upload-photo`, { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Upload failed");
      }

      toast({ title: "Photos uploaded!", description: "Your event photos have been added." });
      fetchPhotos();
      onPhotosChange?.();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error?.message || "Could not upload photos. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
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

  const deletePhoto = async (photoId: string) => {
    try {
      const res = await fetch(`/api/events/${eventId}/delete-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");

      toast({ title: "Photo deleted", description: "The photo has been removed." });
      fetchPhotos();
      onPhotosChange?.();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: error?.message || "Could not delete photo. Please try again.",
      });
    }
  };

  return (
    <Card
      className={`p-6 transition-colors ${isDragging ? "ring-2 ring-primary border-primary bg-primary/5" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDragging) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
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
                    onClick={() => deletePhoto(photo.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {photos.length === 0 && (
          <button
            type="button"
            onClick={() => document.getElementById("photo-upload")?.click()}
            disabled={uploading}
            className="w-full text-center py-8 border-2 border-dashed rounded-lg hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
          >
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">
              {uploading ? "Uploading…" : "Drag photos here, or click to browse"}
            </p>
            <p className="text-sm text-muted-foreground">
              Add photos to create a beautiful results card to share
            </p>
          </button>
        )}
      </div>
    </Card>
  );
}