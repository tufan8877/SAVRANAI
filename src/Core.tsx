import {useMemo,useRef} from 'react'
import {Canvas,useFrame,useThree} from '@react-three/fiber'
import * as T from 'three'
import type {MutableRefObject} from 'react'

export type CoreState = 'STANDBY'|'LISTENING'|'PROCESSING'|'SPEAKING'|'OFFLINE'|'ERROR'
type Props = {state:CoreState; level:MutableRefObject<number>; reduced:boolean}
const TAU = Math.PI*2
const radii=[2.22,2.04,1.85,1.58,1.24,.93]
const angles=[[.07,.07],[.36,-.58],[1.08,.32],[-.78,.72],[.32,1.21],[-.36,-.42]]
function AdaptiveResolution() {
  const setDpr=useThree(state=>state.setDpr)
  const stats=useRef({samples:0,time:0,dpr:Math.min(1.45,devicePixelRatio)})
  useFrame((_,dt)=>{
    const current=stats.current
    if(dt>.15 || dt<=0)return
    current.time+=dt;current.samples++
    if(current.time<2)return
    const fps=current.samples/current.time
    const target=fps<42?Math.max(.75,current.dpr-.15):fps>56?Math.min(1.45,devicePixelRatio,current.dpr+.1):current.dpr
    if(target!==current.dpr){current.dpr=target;setDpr(target)}
    current.samples=0;current.time=0
  })
  return null
}
function buildRing(radius:number, seed:number) {
  let s=seed
  const random=()=>((s=(s*1664525+1013904223)>>>0)/4294967296)
  const points:number[]=[]
  const polar=(a:number,r:number,z:number)=>[Math.cos(a)*r,Math.sin(a)*r,z]
  const line=(a:number,r:number,z:number,b:number,q:number,w:number)=>points.push(...polar(a,r,z),...polar(b,q,w))
  for (let i=0;i<240;i++) {
    const a=i/240*TAU, b=a+TAU/240
    if (random()>.16) line(a,radius,0,b,radius,0)
    if (random()>.38) line(a,radius+.055,0,b,radius+.055,0)
    if (i%2===0 && random()>.14) line(a,radius-.01,0,a,radius-(i%10===0?.19:.085),0)
    if (random()>.76) {
      const z=(random()-.5)*.16, r=radius-.14-random()*.22
      line(a,radius,z,a,r,z)
      line(a,r,z,b+.044,r,z)
      line(b+.044,r,z,b+.044,r+.06,z)
    }
  }
  return new Float32Array(points)
}
function Hologram({state,level,reduced}:Props) {
  const rings=useRef<(T.Group|null)[]>([])
  const shell=useRef<T.Group>(null)
  const pulse=useRef(0)
  const brightness=useRef(1)
  const materials=useRef<(T.LineBasicMaterial|null)[]>([])
  const bands=useMemo(()=>radii.map((r,i)=>buildRing(r,i+10)),[])
  const dust=useMemo(()=>{
    let s=77
    const rand=()=>((s=(s*16807)%2147483647)/2147483647)
    const points=[], stars=[], wires=[]
    for(let i=0;i<2200;i++){
      const a=rand()*TAU, y=rand()*2-1, r=1.12+rand()*1.42, l=Math.sqrt(1-y*y)
      const x=Math.cos(a)*l*r, z=Math.sin(a)*l*r
      points.push(x,y*r,z)
      if(i%15===0){stars.push(x,y*r,z); wires.push(x,y*r,z,x*.94,y*r*.94,z*.94)}
    }
    return {points:new Float32Array(points),stars:new Float32Array(stars),wires:new Float32Array(wires)}
  },[])
  const speed=useRef(.18)
  useFrame(({clock},dt)=>{
    if(reduced) return
    const target=state==='PROCESSING'?1.2:state==='SPEAKING'?.46:state==='LISTENING'?.35:state==='OFFLINE'?.045:.18
    speed.current=T.MathUtils.damp(speed.current,target,3,dt)
    const active=state==='LISTENING'||state==='SPEAKING'
    pulse.current=T.MathUtils.damp(pulse.current,active?Math.min(1,level.current*4):0,10,dt)
    brightness.current=T.MathUtils.damp(brightness.current,state==='OFFLINE'?.25:state==='ERROR'?.54:1,4,dt)
    const time=clock.elapsedTime
    rings.current.forEach((ring,i)=>{
      if(!ring)return
      ring.rotation.z+=Math.min(dt,.05)*speed.current*(i%2?-1:1)*(.28+i*.13)
      ring.rotation.x=angles[i][0]+Math.sin(time*.25+i)*.10
      ring.rotation.y=angles[i][1]+Math.cos(time*.18+i)*.13
      ring.scale.setScalar(1+pulse.current*(.04+i*.008))
      if(materials.current[i]) materials.current[i]!.opacity=(.40+(i===0?.14:0)+pulse.current*.32)*brightness.current
    })
    if(shell.current){shell.current.rotation.y+=dt*speed.current*.25;shell.current.rotation.x+=dt*speed.current*.10;shell.current.scale.setScalar(1+pulse.current*.045)}
  })
  return <group scale={reduced&&state==='OFFLINE'?.93:1}>
    <group ref={shell}>
      <mesh rotation={[.2,.4,0]}><icosahedronGeometry args={[1.98,2]}/><meshBasicMaterial color="#ae6926" wireframe transparent opacity={.085} depthWrite={false}/></mesh>
      <mesh rotation={[.1,.4,.3]}><icosahedronGeometry args={[1.39,1]}/><meshBasicMaterial color="#ffb44f" wireframe transparent opacity={.16} depthWrite={false}/></mesh>
      <lineSegments><bufferGeometry><bufferAttribute attach="attributes-position" args={[dust.wires,3]}/></bufferGeometry><lineBasicMaterial color="#f5a53e" transparent opacity={.36} depthWrite={false} blending={T.AdditiveBlending}/></lineSegments>
      {[dust.points,dust.stars].map((array,i)=><points key={i}><bufferGeometry><bufferAttribute attach="attributes-position" args={[array,3]}/></bufferGeometry><pointsMaterial color={i?'#ffdda2':'#f0a04c'} size={i?.033:.017} transparent opacity={i?.8:.53} depthWrite={false} blending={T.AdditiveBlending}/></points>)}
    </group>
    {bands.map((positions,i)=><group key={i} ref={node=>{rings.current[i]=node}} rotation={[...angles[i],i*.94] as [number,number,number]}>
      <lineSegments><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions,3]}/></bufferGeometry><lineBasicMaterial ref={node=>{materials.current[i]=node}} color={i%2?'#e89635':'#ffc773'} transparent opacity={.5} depthWrite={false} blending={T.AdditiveBlending}/></lineSegments>
      {i<4&&<mesh><torusGeometry args={[radii[i],.009,5,128]}/><meshBasicMaterial color="#fda744" transparent opacity={.18} blending={T.AdditiveBlending} depthWrite={false}/></mesh>}
    </group>)}
    <mesh><sphereGeometry args={[.25,20,12]}/><meshBasicMaterial color="#ffdda3" transparent opacity={.75} wireframe blending={T.AdditiveBlending} depthWrite={false}/></mesh>
  </group>
}
export default function Core(props:Props) {
  const webgl=useMemo(()=>{
    if(typeof WebGL2RenderingContext==='undefined')return false
    const context=document.createElement('canvas').getContext('webgl2',{powerPreference:'low-power'})
    context?.getExtension('WEBGL_lose_context')?.loseContext()
    return Boolean(context)
  },[])
  if(!webgl)return null
  return <Canvas aria-hidden="true" dpr={[.85,1.45]} frameloop={props.reduced?'demand':'always'}
    camera={{position:[0,0,8.8],fov:36}} gl={{alpha:true,antialias:true,powerPreference:'low-power'}} fallback={null}>
    {!props.reduced&&<AdaptiveResolution/>}
    <Hologram {...props}/>
  </Canvas>
}
