import { NextRequest, NextResponse } from "next/server";

interface FigmaDiagram {
  id: string;
  fileKey: string;
  pageId: string;
  pageName: string;
  title: string;
  description?: string;
  diagramType: "workflow" | "architecture" | "process" | "entity" | "custom";
  category?: string;
  tags?: string[];
  thumbnailUrl?: string;
  createdAt: string;
}

// Fetch Figma diagrams from Supabase
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    // Get query params for filtering
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const type = searchParams.get("type");
    const search = searchParams.get("search");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    // Build query
    let query = `${supabaseUrl}/rest/v1/figma_diagrams?select=*&is_active=eq.true&order=created_at.desc&limit=${limit}`;

    // Add filters
    if (category) {
      query += `&category=eq.${encodeURIComponent(category)}`;
    }
    if (type) {
      query += `&diagram_type=eq.${encodeURIComponent(type)}`;
    }

    const response = await fetch(query, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to fetch diagrams:", error);
      return NextResponse.json(
        { error: `Failed to fetch diagrams: ${response.statusText}` },
        { status: response.status }
      );
    }

    const rawDiagrams = await response.json();

    // Transform to frontend format
    let diagrams: FigmaDiagram[] = rawDiagrams.map((d: Record<string, unknown>) => ({
      id: d.id as string,
      fileKey: d.file_key as string,
      pageId: d.page_id as string,
      pageName: d.page_name as string,
      title: d.title as string,
      description: d.description as string | undefined,
      diagramType: d.diagram_type as FigmaDiagram["diagramType"],
      category: d.category as string | undefined,
      tags: d.tags as string[] | undefined,
      thumbnailUrl: d.thumbnail_url as string | undefined,
      createdAt: d.created_at as string,
    }));

    // Apply search filter (client-side full-text search)
    if (search) {
      const searchLower = search.toLowerCase();
      diagrams = diagrams.filter((d) =>
        d.title.toLowerCase().includes(searchLower) ||
        d.description?.toLowerCase().includes(searchLower) ||
        d.pageName.toLowerCase().includes(searchLower) ||
        d.category?.toLowerCase().includes(searchLower)
      );
    }

    return NextResponse.json({ diagrams });
  } catch (error) {
    console.error("Diagrams API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch diagrams" },
      { status: 500 }
    );
  }
}
