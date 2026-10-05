// Raw OpenAPI 3 spec (import into Postman). Public, like the original API's docs.
import { NextResponse } from 'next/server';
import spec from '@/lib/downloader/openapi.json';

export const GET = () => NextResponse.json(spec);
