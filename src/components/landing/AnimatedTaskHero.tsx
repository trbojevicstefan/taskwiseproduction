
// src/components/landing/AnimatedTaskHero.tsx
import React from 'react';
import { Check, CheckCircle, ListTodo, FolderCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface TaskCardProps extends React.HTMLAttributes<HTMLDivElement> {
    animationDelay?: string;
    startX?: string; startY?: string; startZ?: string;
    endX?: string; endY?: string; endZ?: string;
}

const AnimatedTask: React.FC<TaskCardProps> = ({ children, className, ...props }) => {
    const style = {
        '--start-x': props.startX, '--start-y': props.startY, '--start-z': props.startZ,
        '--end-x': props.endX, '--end-y': props.endY, '--end-z': props.endZ,
        animationDelay: props.animationDelay,
    } as React.CSSProperties;

    return (
        <div style={style} className={`hero-task-card animate-task-merge ${className}`}>
            {children}
        </div>
    );
}

const AnimatedTaskHero = () => {
    const endPosition = { x: '200px', y: '150px', z: '50px' };

    return (
        <div className="hero-animation-container">
            {/* Merged Task in the center */}
             <div 
                className="hero-task-card w-64 bg-primary/20 border-primary animate-main-task-fade-in"
                style={{
                    left: endPosition.x,
                    top: endPosition.y,
                    transform: 'translateZ(50px)', // Bring it forward
                    animationDelay: '0s',
                }}
            >
                <FolderCheck size={20} className="text-primary" />
                <p className="text-md font-bold">Organized Project Plan</p>
            </div>


            {/* Batch 1 of flying tasks */}
            <AnimatedTask {...endPosition} animationDelay="0s" startX="50px" startY="50px" startZ="-200px">
                <Check size={16} /> <p className="text-sm">Define Target Audience</p>
            </AnimatedTask>
             <AnimatedTask {...endPosition} animationDelay="-1.5s" startX="0px" startY="250px" startZ="200px">
                <Check size={16} /> <p className="text-sm">Create Ad Copy</p>
            </AnimatedTask>

            {/* Batch 2 of flying tasks */}
             <AnimatedTask {...endPosition} animationDelay="-3s" startX="350px" startY="80px" startZ="-150px">
                <p className="text-sm">Backend API work</p><Badge variant="destructive">High</Badge>
            </AnimatedTask>
             <AnimatedTask {...endPosition} animationDelay="-4.5s" startX="400px" startY="300px" startZ="150px">
                <ListTodo size={16} className="text-blue-400" /> <p className="text-sm">Frontend Work</p>
            </AnimatedTask>
            
             {/* Batch 3 of flying tasks */}
            <AnimatedTask {...endPosition} animationDelay="-6s" startX="80px" startY="350px" startZ="-50px">
                <CheckCircle size={16} className="text-green-500" /> <p className="text-sm">Deploy to Staging</p>
            </AnimatedTask>
            <AnimatedTask {...endPosition} animationDelay="-7.5s" startX="450px" startY="150px" startZ="250px">
                 <p className="text-sm">User acceptance testing</p><Badge variant="secondary">Med</Badge>
            </AnimatedTask>
        </div>
    );
};

export default AnimatedTaskHero;
