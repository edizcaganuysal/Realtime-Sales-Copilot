import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PlaybooksService } from './playbooks.service';
import { CreatePlaybookDto } from './dto/create-playbook.dto';
import { UpdatePlaybookDto } from './dto/update-playbook.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';

@Controller('playbooks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MANAGER)
export class PlaybooksController {
  constructor(private readonly playbooksService: PlaybooksService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.playbooksService.list(user.orgId);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePlaybookDto) {
    return this.playbooksService.create(user.orgId, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.playbooksService.findOne(user.orgId, id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePlaybookDto,
  ) {
    return this.playbooksService.update(user.orgId, id, dto);
  }

  @Post(':id/set-default')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  setDefault(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.playbooksService.setDefault(user.orgId, id);
  }

  @Post(':id/stages')
  @Roles(Role.ADMIN)
  addStage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateStageDto,
  ) {
    return this.playbooksService.addStage(user.orgId, id, dto);
  }

  @Post(':id/stages/reorder')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  reorderStages(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReorderStagesDto,
  ) {
    return this.playbooksService.reorderStages(user.orgId, id, dto);
  }
}

@Controller('playbook-stages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PlaybookStagesController {
  constructor(private readonly playbooksService: PlaybooksService) {}

  @Patch(':id')
  updateStage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateStageDto,
  ) {
    return this.playbooksService.updateStage(user.orgId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  deleteStage(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.playbooksService.deleteStage(user.orgId, id);
  }
}
