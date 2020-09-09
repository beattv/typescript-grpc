
#

## Instalation

```npm i --save typescript-grpc-server```

## Usage

```typescript
export class Identifier {
  @Property()
  type: IdentifierType

  @Property()
  value: string
}

export default class User {
  @Property()
  _id: string

  @Property({ customType: Identifier })
  identifiers: Identifier[]
}

...
import { Call, Property, Service } from 'typescript-grpc-server'
import User from '../models/user.model'

class GetUserByIdInput {
  @Property()
  userId: string
}

@Service
class UserService {
  @Call({ returnType: [User] })
  async getUsers (data: GetUserByIdInput): Promise<User[]> {
    return
  }

  @Call({ returnType: User })
  async getUser (params: GetUserByIdInput): Promise<User> {
    const user = new User()
    user._id = 'Test'

    return user
  }
}

export default UserService
```

And then start up server.

```typescript
import { TypescriptGrpcServer } from 'typescript-grpc-server'

grpcServer = new TypescriptGrpcServer({
  servicesPath: '/src/grpc/*.service.ts',
  generatedPath: './generated',
  port: '50051'
})

grpcServer.start().then(() => console.log('Server started'))
```
