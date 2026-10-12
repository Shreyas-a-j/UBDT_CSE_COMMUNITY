import { NextRequest, NextResponse } from 'next/server';
import { AwsClient } from 'aws4fetch';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as Blob | null;
    const filename = (formData.get('filename') as string) || `${Date.now()}.webp`;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400, headers: corsHeaders }
      );
    }

    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.replace(/[<>]/g, '').trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.replace(/[<>]/g, '').trim();
    const accountId = process.env.R2_ACCOUNT_ID?.replace(/[<>]/g, '').trim();
    const bucketName = process.env.R2_BUCKET_NAME?.replace(/[<>]/g, '').trim();
    const publicDomain = process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN?.replace(/[<>]/g, '').trim();

    if (!accessKeyId || !secretAccessKey || !accountId || !bucketName || !publicDomain) {
      return NextResponse.json(
        { error: 'Server storage configuration is missing' },
        { status: 500, headers: corsHeaders }
      );
    }

    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `avatars/${crypto.randomUUID()}-${safeFilename}`;

    const aws = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: 's3',
      region: 'auto',
    });

    const s3Endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${key}`;
    const arrayBuffer = await file.arrayBuffer();

    const uploadRes = await aws.fetch(s3Endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'image/webp',
      },
      body: arrayBuffer,
    });

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      return NextResponse.json(
        { error: `R2 upload failed (${uploadRes.status}): ${errorText}` },
        { status: uploadRes.status, headers: corsHeaders }
      );
    }

    const cleanDomain = publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const publicUrl = `https://${cleanDomain}/${key}`;

    return NextResponse.json(
      {
        publicUrl,
        key,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Internal Server Error: ${message}` },
      { status: 500, headers: corsHeaders }
    );
  }
}
