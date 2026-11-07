import { PipeTransform } from "@nestjs/common";
import z from "zod";
import { ValidationException } from "./validation.exception.ts";

export class ZodValidationPipe implements PipeTransform{
    constructor(private readonly schema:z.ZodType){}
    transform(value: unknown) {
        const result = this.schema.safeParse(value)
        if(!result.success){
            throw new ValidationException(z.flattenError(result.error).fieldErrors)
        }
        return result.data;
    }
}