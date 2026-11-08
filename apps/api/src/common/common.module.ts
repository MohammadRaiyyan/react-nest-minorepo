import { Global, Module } from "@nestjs/common";
import { IdempotencyStore } from "./idempotency.store.ts";

@Global()
@Module({
    providers:[IdempotencyStore],
    exports:[IdempotencyStore]
})
export class CommonModule{
    
}