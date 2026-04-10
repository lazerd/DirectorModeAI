import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, ImageIcon } from "lucide-react";

interface LogoUploaderProps {
  eventId: string;
  onLogoChange?: (url: string | null) => void;
}

const LogoUploader = ({ eventId, onLogoChange }: LogoUploaderProps) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchLogo();
  }, [eventId]);

  const fetchLogo = async () => {
    const { data } = await supabase
      .from("events")
      .select("logo_url")
      .eq("id", eventId)
      .single();

    if (data?.logo_url) {
      setLogoUrl(data.logo_url);
      onLogoChange?.(data.logo_url);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        variant: "destructive",
        title: "Invalid file",
        description: "Please upload an image file (PNG, JPG, etc.)",
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: "Logo must be under 2MB.",
      });
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split(".").pop();
      const filePath = `logos/${eventId}/logo.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("event-assets")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("event-assets")
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl + "?t=" + Date.now();

      const { error: updateError } = await supabase
        .from("events")
        .update({ logo_url: publicUrl })
        .eq("id", eventId);

      if (updateError) throw updateError;

      setLogoUrl(publicUrl);
      onLogoChange?.(publicUrl);

      toast({
        title: "Logo uploaded!",
        description: "Your logo will appear on results cards.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error.message,
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeLogo = async () => {
    try {
      await supabase
        .from("events")
        .update({ logo_url: null })
        .eq("id", eventId);

      setLogoUrl(null);
      onLogoChange?.(null);

      toast({
        title: "Logo removed",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  return (
    <div className="flex items-center gap-3">
      {logoUrl ? (
        <div className="relative group">
          <img
            src={logoUrl}
            alt="Club logo"
            className="w-14 h-14 rounded-xl object-cover border-2 border-gray-200"
          />
          <button
            onClick={removeLogo}
            className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-14 h-14 rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors cursor-pointer"
        >
          {uploading ? (
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <ImageIcon className="h-5 w-5" />
          )}
        </button>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-700">
          {logoUrl ? "Club Logo" : "Add Club Logo"}
        </p>
        <p className="text-xs text-gray-500">
          {logoUrl ? "Shown on results cards" : "PNG or JPG, under 2MB"}
        </p>
      </div>
      {!logoUrl && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="h-4 w-4 mr-1" />
          Upload
        </Button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        className="hidden"
      />
    </div>
  );
};

export default LogoUploader;
