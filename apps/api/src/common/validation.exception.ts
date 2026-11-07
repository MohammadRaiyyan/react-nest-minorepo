import { BadRequestException } from "@nestjs/common";

export class ValidationException extends BadRequestException{
    constructor(public readonly fieldErrors:Record<string,string[] | undefined>){
        super("This request body has invalid fields")
    }
}