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
    const body = await req.json();
    const { filename, contentType } = body;

    if (!filename || typeof filename !== 'string') {
      return NextResponse.json(
        { error: 'Invalid or missing filename' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!contentType || typeof contentType !== 'string' || !contentType.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Invalid content-type: must be an image' },
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

    if (
      accountId.includes('your_cloudflare_account_id') ||
      bucketName.includes('your_r2_bucket_name')
    ) {
      return NextResponse.json(
        { error: 'R2 environment variables in .env.local contain unconfigured placeholder values.' },
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

    // Generate AWS SigV4 presigned PUT URL with 3600s expiration
    const signedRequest = await aws.sign(
      new Request(s3Endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
        },
      }),
      {
        aws: { signQuery: true },
      }
    );

    const cleanDomain = publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const publicUrl = `https://${cleanDomain}/${key}`;

    return NextResponse.json(
      {
        uploadUrl: signedRequest.url,
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
