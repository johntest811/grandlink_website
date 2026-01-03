import { NextResponse } from "next/server";
import { sendVerificationCode, verifyVerificationCode } from "./service";

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { email, resend } = await req.json();
    
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const result = await sendVerificationCode(email, Boolean(resend));
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, message: result.message });

  } catch (error: any) {
    console.error('Error sending verification code:', error);
    return NextResponse.json({ error: "Failed to send verification code" }, { status: 500 });
  }
}

// Endpoint to verify the code
export async function PUT(req: Request) {
  try {
    const { email, code } = await req.json();

    const result = verifyVerificationCode(email, code);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, message: result.message });

  } catch (error: any) {
    console.error('Error verifying code:', error);
    return NextResponse.json({ error: "Failed to verify code" }, { status: 500 });
  }
}
