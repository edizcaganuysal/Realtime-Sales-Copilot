import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const USER_COLUMNS = {
  id: schema.users.id,
  name: schema.users.name,
  email: schema.users.email,
  role: schema.users.role,
  status: schema.users.status,
  createdAt: schema.users.createdAt,
} as const;

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  list(orgId: string) {
    return this.db
      .select(USER_COLUMNS)
      .from(schema.users)
      .where(eq(schema.users.orgId, orgId))
      .orderBy(asc(schema.users.createdAt));
  }

  async create(orgId: string, dto: CreateUserDto) {
    const existing = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, dto.email))
      .limit(1);

    if (existing.length) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const [user] = await this.db
      .insert(schema.users)
      .values({ orgId, name: dto.name, email: dto.email, role: dto.role, passwordHash })
      .returning(USER_COLUMNS);

    return user;
  }

  async update(orgId: string, userId: string, dto: UpdateUserDto) {
    const [user] = await this.db
      .update(schema.users)
      .set(dto)
      .where(and(eq(schema.users.id, userId), eq(schema.users.orgId, orgId)))
      .returning(USER_COLUMNS);

    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
