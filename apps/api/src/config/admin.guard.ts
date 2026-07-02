import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/** Gate for admin-only writes: requires x-admin-token to match ADMIN_TOKEN. Fails closed. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const provided = req.headers['x-admin-token'];
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) throw new UnauthorizedException('admin token not configured');
    if (typeof provided !== 'string' || !safeEqual(provided, expected)) {
      throw new UnauthorizedException('invalid admin token');
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
