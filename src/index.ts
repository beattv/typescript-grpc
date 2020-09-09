import 'reflect-metadata'
import * as grpc from '@grpc/grpc-js'
import { promises as fs } from 'fs'

const glob = require('glob-fs')({ gitignore: true })
const protoLoader = require('@grpc/proto-loader')

interface IMessageAttribute {
  name: string
  type: string
  customType?: any
}

interface IMessage {
  name: string
  attributes: IMessageAttribute[]
}

interface ICallReturnType {
  type: string
  isArray?: boolean
}

interface ICall {
  name: string
  parameters: any
  returnType: ICallReturnType
  injectContext?: boolean
}

interface IService {
  name: string
  instance?: any
  calls: ICall[]
}

interface ITsGrpcProperty {
  customType?: any
}

interface ITsGrpcCall {
  returnType: any
}

interface Configuration {
  servicesPath: string
  generatedPath: string
  port: string
}

const messages = [] as IMessage[]
const services = [] as IService[]
const contextDecorators = {}

export const Service = (constructor: Function) => {
  const service = services.find(service => service.name === constructor.name)
  if (!service) {
    services.push({
      name: constructor.name,
      calls: []
    })
  }
}

export const Call = (params?: ITsGrpcCall) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    // check if it is a Promise?
    let returnType = params?.returnType.constructor.name
    if (returnType === 'Array') {
      returnType = { type: new params.returnType[0]().constructor.name, isArray: true }
    } else if (params?.returnType) {
      returnType = { type: new params.returnType().constructor.name }
    }

    const service = services.find(service => service.name === target.constructor.name)
    const parameters = Reflect.getMetadata('design:paramtypes', target, propertyKey)
    if (service) {
      service.calls.push({
        name: propertyKey,
        parameters: [parameters[parameters.length - 1].name],
        returnType
      })
    } else {
      services.push({
        name: target.constructor.name,
        calls: [{
          name: propertyKey,
          parameters: [parameters[parameters.length - 1].name],
          returnType
        }]
      })
    }
  }
}

export const GrpcCall = (target: Object, propertyKey: string | symbol, parameterIndex: number) => {
  contextDecorators[`${target.constructor.name}-${propertyKey.toString()}`] = true
}

export const Property = (params?: ITsGrpcProperty) => {
  return (target: Object, propertyKey: string) => {
    const propertyMetaInfo = { name: propertyKey, type: Reflect.getMetadata('design:type', target, propertyKey).name, customType: params?.customType }
    const message = messages.find(message => message.name === target.constructor.name)

    if (message) {
      message.attributes.push(propertyMetaInfo)
    } else {
      messages.push({
        name: target.constructor.name,
        attributes: [propertyMetaInfo]
      })
    }
  }
}

export class TypescriptGrpcServer {
  private configuration: Configuration

  constructor (configuration: Configuration) {
    this.configuration = configuration
  }

  async start () {
    const files = await glob.readdirPromise(this.configuration.servicesPath)

    // !this will stop node thread, until imports are done!
    // but we are still starting service, it will only increase boot time
    for (const file of files) {
      const ServiceModule = await import(file)
      const serviceModule = new ServiceModule.default()
      const service = services.find(service => service.name === serviceModule.constructor.name)

      service.instance = serviceModule
    }

    const proto = `
      syntax = "proto3";
      ${messages.map(message => `
      message ${message.name} {
        ${message.attributes.map((attr, index) => `${this.resolveType(attr)} ${attr.name} = ${index + 1};`).join('\n\t')}
      }
      `).join('')}
      ${services.map(service => `
      service ${service.name} {
        ${service.calls.map(call => `rpc ${call.name}(${call.parameters.map(param => this.resolveType({ name: '', type: param })).join(' ')}) returns (${call.returnType.isArray ? 'stream ' : ''}${this.resolveType({ name: '', type: call.returnType.type })});`).join('\n\t')}
      }
      `).join('')}
    `

    const protoDefinitionPath = `${this.configuration.generatedPath}/def.proto`
    await fs.mkdir(this.configuration.generatedPath, { recursive: true })
    await fs.writeFile(protoDefinitionPath, proto)
    const packageDefinition = await protoLoader.load(`${protoDefinitionPath}`)
    const packageObject = grpc.loadPackageDefinition(packageDefinition)
    const server = new grpc.Server()

    const calls = {}
    for (const service of services) {
      for (const serviceCall of service.calls) {
        calls[serviceCall.name] = async (call, callback) => {
          const params = []
          if (contextDecorators[`${service.name}-${serviceCall.name}`]) {
            params.push(call)
          }

          params.push(call.request)

          const serviceResponse = await service.instance[serviceCall.name].apply(undefined, params)
          callback(undefined, serviceResponse)
        }
      }

      server.addService((packageObject[(service as any).instance.constructor.name] as any).service, calls)
    }

    return new Promise((resolve, reject) => {
      server.bindAsync(`0.0.0.0:${this.configuration.port}`, grpc.ServerCredentials.createInsecure(), async (error, port) => {
        server.start()
        resolve()
      })
    })
  }

  private resolveType (params: IMessageAttribute): string {
    if (params.customType) {
      params.customType = new params.customType()?.constructor.name
    }

    switch (params.type) {
      case 'Array':
        return `repeated ${params.customType}`
      case 'String':
        return 'string'
      default:
        return `${params.type}`
    }
  }
}