interface DatabaseConnectionInfo {
    host : string;
    port : number;
    user : string;
    password : string;
    database : string;
}

export interface Configuration {
    db : DatabaseConnectionInfo;
    dev : {
        use : boolean;
    };
    http : {
        port : number;
        secret : string;
    };
}
