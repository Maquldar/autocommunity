import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { MeController } from './me.controller';
import { RelationService } from './relation.service';
import { UserViewService } from './user-view.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [UploadsModule, VehiclesModule],
  controllers: [MeController, UsersController],
  providers: [UsersService, UserViewService, RelationService],
  exports: [UsersService, UserViewService, RelationService],
})
export class UsersModule {}
