import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CallsService } from './calls.service';
import { EngineService } from './engine.service';
import { CreateCallDto } from './dto/create-call.dto';
import { UpdateCallDto } from './dto/update-call.dto';

@Controller('calls')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.REP)
export class CallsController {
  constructor(
    private readonly callsService: CallsService,
    private readonly engineService: EngineService,
  ) {}

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCallDto) {
    const call = await this.callsService.create(user, dto);
    this.engineService.start(call.id);
    return call;
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.callsService.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.callsService.get(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCallDto,
  ) {
    return this.callsService.update(user, id, dto);
  }

  @Post(':id/end')
  @HttpCode(200)
  async end(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    this.engineService.stop(id);
    return this.callsService.end(user, id);
  }

  @Post(':id/suggestions/more')
  @HttpCode(200)
  moreSuggestions(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.callsService.moreSuggestions(user, id);
  }
}
